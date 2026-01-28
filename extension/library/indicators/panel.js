import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import * as Logger from '../logger.js';
import { setPercentLabel } from '../label.js';
import { getIndicatorPosition } from '../settings.js';

export const BrightnessPanelIndicator = GObject.registerClass(
    class BrightnessPanelIndicator extends PanelMenu.Button {
        _init(extension) {
            super._init(0.0, 'Brightness Restore', false);
            this._extension = extension;
            this._settings = extension._settings;

            const box = new St.BoxLayout({
                style_class: 'panel-status-menu-box',
            });

            this._icon = new St.Icon({
                icon_name: 'display-brightness-symbolic',
                style_class: 'system-status-icon',
            });
            Logger.debug(`[PanelMenu] Icon created: ${this._icon}`);

            this._label = new St.Label({
                text: '...',
                y_align: Clutter.ActorAlign.CENTER,
            });
            Logger.debug(`[PanelMenu] Label created: ${this._label}`);

            box.add_child(this._icon);
            box.add_child(this._label);
            this.add_child(box);
            Logger.debug('[PanelMenu] Children added to box and button.');

            this._sliderItem = new PopupMenu.PopupBaseMenuItem({
                activate: false,
            });

            this._slider = new Slider.Slider(0);
            this._slider.accessible_name = 'Brightness';

            this._slider.connect('notify::value', () => {
                this._extension._onSliderChanged(this._slider.value);
            });

            this._sliderItem.add_child(this._slider);
            this.menu.addMenuItem(this._sliderItem);

            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const settingsItem = new PopupMenu.PopupMenuItem('Settings');
            settingsItem.connect('activate', () => {
                extension.openPreferences();
            });
            this.menu.addMenuItem(settingsItem);
        }

        update(percent, valueNormalized) {
            setPercentLabel(this._label, percent);

            if (Math.abs(this._slider.value - valueNormalized) > 0.01) {
                this._slider.value = valueNormalized;
            }
        }

        ensurePosition() {
            const pos = getIndicatorPosition(this._settings);
            const parent = this.get_parent();
            if (!parent) return;

            const children = parent.get_children();
            if (pos === 'left') {
                parent.set_child_at_index(this, 0);
            } else {
                parent.set_child_at_index(this, children.length - 1);
            }
        }
    },
);
