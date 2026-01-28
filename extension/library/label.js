/**
 * Update a label with a percentage value.
 *
 * @param {object} label - St.Label instance.
 * @param {number} percent - Percent value to display.
 */
export function setPercentLabel(label, percent) {
    if (!label) return;
    label.text = `${percent}%`;
}
