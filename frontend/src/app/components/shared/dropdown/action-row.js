/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { isObject, noop } from 'utils/core-utils';
import { randomString } from 'utils/string-utils';

function _getActionTooltip(tooltip) {
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

export default class ActionRowViewModel {
    focusId = randomString()
    clickHandler = null;
    focusHandler = null;
    label = ko.observable();
    disabled = ko.observable();
    hasFocus = ko.observable();
    tooltip = ko.observable();

    constructor({ onFocus }) {
        this.focusHandler = onFocus;
    }

    onUpdate(action, focus) {
        const {
            label = action,
            disabled = false,
            tooltip,
            onClick = noop
        } = action;

        this.label(label);
        this.disabled(disabled);
        this.tooltip(_getActionTooltip(tooltip));
        this.clickHandler = onClick;
        this.hasFocus(focus === this.focusId);
    }

    onClick() {
        this.clickHandler();
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
