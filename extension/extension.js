import Clutter from 'gi://Clutter';

import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { SystemIndicator } from 'resource:///org/gnome/shell/ui/quickSettings.js';

import * as Logger from './library/logger.js';

const BrightnessIndicator = GObject.registerClass(
    class BrightnessIndicator extends SystemIndicator {
        _init(extension) {
            super._init();
            this._extension = extension;
            this._settings = extension.getSettings();
            this._defaultIndex = null;
            this._defaultParent = null;

            // Create Icon/Label container
            this._box = new St.BoxLayout({
                style_class: 'panel-status-indicators-box',
                reactive: true,
            });

            this._icon = new St.Icon({
                icon_name: 'display-brightness-symbolic',
                style_class: 'system-status-icon',
            });

            this._label = new St.Label({
                y_align: Clutter.ActorAlign.CENTER,
                text: '...',
                style_class: 'brightness-label',
            });

            this._box.add_child(this._icon);
            this._box.add_child(this._label);

            this._indicator = this._addIndicator();
            this._indicator.add_child(this._box);

            // Initial integration
            this._integrate();

            // React to re-layouts (ensures position persists)
            this._box.connectObject('notify::allocation', () => this._ensurePosition(), this);
        }

        update(percent) {
            this._label.text = `${percent}%`;
        }

        _integrate() {
            const qs = Main.panel.statusArea.quickSettings;
            if (qs) {
                qs.addExternalIndicator(this);
                this._captureDefaultPosition();
                this._ensurePosition();
            }
        }

        _captureDefaultPosition() {
            const parent = this.get_parent();
            if (!parent || !parent.get_children) return;
            this._defaultParent = parent;
            const children = parent.get_children();
            const index = children.indexOf(this);
            this._defaultIndex = index >= 0 ? index : null;
        }

        _ensurePosition() {
            const pos = this._settings.get_string('indicator-position');
            const actor = this;
            const parent = actor.get_parent(); // The container in QuickSettings
            if (!parent) return;

            if (pos === 'left') {
                if (parent.set_child_above_sibling) {
                    parent.set_child_above_sibling(actor, null);
                } else if (parent.set_child_at_index) {
                    parent.set_child_at_index(actor, 0);
                }
            } else if (pos === 'right') {
                if (parent.set_child_below_sibling) {
                    parent.set_child_below_sibling(actor, null);
                } else if (parent.get_n_children) {
                    parent.set_child_at_index(actor, Math.max(parent.get_n_children() - 1, 0));
                }
            } else if (this._defaultParent === parent && this._defaultIndex !== null && parent.get_n_children) {
                parent.set_child_at_index(actor, Math.min(this._defaultIndex, parent.get_n_children() - 1));
            }
        }
    },
);

export default class BrightnessRestoreExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // Initialize Logger
        Logger.init('Brightness Restore');
        Logger.updateSettings(this._settings);

        Logger.info('Enabling Brightness Restore (SystemIndicator)...');

        // Create Indicator
        this._indicator = new BrightnessIndicator(this);

        // Connect Settings Listener (For manual slider & position)
        this._settingsSignal = this._settings.connect('changed', (settings, key) => {
            if (['debug', 'loglevel', 'logtofile', 'logfilepath'].includes(key)) {
                Logger.updateSettings(this._settings);
            } else if (key === 'last-brightness') {
                this._onManualBrightnessRequest();
            } else if (key === 'indicator-position') {
                this._indicator._ensurePosition();
            }
        });

        // Connect Brightness & Restore
        // Wait for system to settle slightly
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
            this._connectBrightness();
            return GLib.SOURCE_REMOVE;
        });
    }

    _connectBrightness() {
        // REVERT TO REFERENCE IMPLEMENTATION
        // Using Main.brightnessManager.globalScale (standard Gnome behavior)
        const bm = Main.brightnessManager;

        if (!bm || !bm.globalScale) {
            Logger.warn('Main.brightnessManager.globalScale not found.');
            this._indicator.update('Err');
            return;
        }

        this._proxy = bm.globalScale;
        Logger.info('Connected via brightnessManager.globalScale');

        // RESTORE
        if (this._settings.get_boolean('restore-on-startup')) {
            const saved = this._settings.get_double('last-brightness');
            if (saved >= 0 && saved <= 1.0) {
                Logger.info(`Restoring brightness to ${saved}`);
                // Safely set invalid initial value
                try {
                    this._proxy.value = saved;
                } catch (e) {
                    Logger.error(`Restore failed: ${e.message}`);
                }
            }
        }

        // LISTEN
        // globalScale is an adjustment (GObject), so we listen to 'notify::value'
        this._proxyId = this._proxy.connect('notify::value', () => {
            this._onChanged();
        });

        // Initial Update
        this._onChanged();
    }

    _onChanged() {
        // Read directly from proxy
        const val = this._proxy.value;
        if (typeof val === 'number' && !isNaN(val)) {
            Logger.info(`Brightness changed: ${Math.round(val * 100)}%`);
        }
        this._updateUI(val);
        this._saveBrightness(val);
    }

    _onManualBrightnessRequest() {
        if (!this._proxy) return;
        const target = this._settings.get_double('last-brightness');
        const current = this._proxy.value;

        if (Math.abs(current - target) > 0.01) {
            Logger.info(`Manual request: ${target}`);
            try {
                this._proxy.value = target;
            } catch (e) {
                Logger.error(`Manual set failed: ${e.message}`);
            }
        }
    }

    _saveBrightness(value) {
        // Save to GSettings (Debounced)
        if (this._saveTimeoutId) GLib.source_remove(this._saveTimeoutId);
        this._saveTimeoutId = GLib.timeout_add(GLib.PRIORITY_LOW, 1000, () => {
            // Only write if different to avoid loop trigger from ourselves (mostly handled by _onManual check but safety first)
            const stored = this._settings.get_double('last-brightness');
            if (Math.abs(stored - value) > 0.01) {
                this._settings.set_double('last-brightness', value);
            }
            this._saveTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateUI(value) {
        if (typeof value !== 'number' || isNaN(value)) {
            this._indicator.update('?');
            return;
        }
        const pct = Math.round(value * 100);
        this._indicator.update(pct);
    }

    disable() {
        Logger.info('Disabling Brightness Restore...');

        if (this._settingsSignal) {
            this._settings.disconnect(this._settingsSignal);
            this._settingsSignal = null;
        }

        if (this._saveTimeoutId) {
            GLib.source_remove(this._saveTimeoutId);
            this._saveTimeoutId = null;
        }

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }

        if (this._proxyId && this._proxy) {
            this._proxy.disconnect(this._proxyId);
            this._proxyId = null;
        }
        this._proxy = null;

        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        this._settings = null;
    }
}
