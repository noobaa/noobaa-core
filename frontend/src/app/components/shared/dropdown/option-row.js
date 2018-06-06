/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { isObject } from 'utils/core-utils';
import { randomString } from 'utils/string-utils';

function _getOptionTooltip(tooltip) {
    if (!tooltip) {
        return '';
    }

    if (isObject(tooltip) && !Array.isArray(tooltip) && !null) {
        return {
            ...tooltip,
            position: 'after'
        };
    }

    return {
        text: tooltip,
        position: 'after'
    };
}

export default class OptionRowViewModel {
    focusId = randomString();
    focusHandler = null;
    value = ko.observable();
    label = ko.observable();
    remark = ko.observable();
    icon = ko.observable();
    tooltip = ko.observable();
    css = ko.observable();
    disabled = ko.observable();
    selected = ko.observable();
    tabIndex = ko.observable();
    hasFocus = ko.observable();

    constructor({ onFocus }) {
        this.focusHandler = onFocus;
    }

    onUpdate(option, multiselect, selectedValues, focus) {
        const {
            value = option,
            label = value,
            remark = '',
            icon,
            selectedIcon = icon,
            css,
            disabled = false
        } = option;

        const isSelected = selectedValues.includes(value);

        this.value(value);
        this.label(label.toString());
        this.remark(remark);
        this.icon(isSelected ? selectedIcon : icon);
        this.tooltip(_getOptionTooltip(option.tooltip));
        this.css(css);
        this.disabled(disabled);
        this.selected(isSelected);
        this.tabIndex(disabled ? false : '0');
        this.hasFocus(focus === this.focusId);
    }

    onFocus(val) {
        this.focusHandler(val ? this.focusId : '');
    }

    onMouseDown() {
        // Prevent disabled options form foucsing out
        // the active element.
        return !this.disabled();
    }
}

