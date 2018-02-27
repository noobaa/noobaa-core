/* Copyright (C) 2016 NooBaa */

import template from './toggle-switch.html';
import ko from 'knockout';

class ToggleSwitchViewModel {
    constructor(params) {
        const {
            value = ko.observable(true),
            onLabel = 'on',
            offLabel = 'off',
            disabled = false,
            hasFocus = false
        } = params;

        this.value = value;
        this.disabled = disabled;
        this.hasFocus = hasFocus;
        this.label = ko.pureComputed(() =>
            ko.unwrap(value) ? ko.unwrap(onLabel) : ko.unwrap(offLabel)
        );
    }
}

export default {
    viewModel: ToggleSwitchViewModel,
    template: template
};
