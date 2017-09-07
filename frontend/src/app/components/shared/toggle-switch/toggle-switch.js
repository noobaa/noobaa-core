/* Copyright (C) 2016 NooBaa */

import template from './toggle-switch.html';
import ko from 'knockout';

class ToggleSwitchViewModel {
    constructor({
        value = ko.observable(true),
        onLabel = 'on',
        offLabel = 'off',
        disabled = false

    }) {
        this.value = value;
        this.label = ko.pureComputed(
            () => ko.unwrap(value) ? ko.unwrap(onLabel) : ko.unwrap(offLabel)
        );
        this.disabled = disabled;
    }
}

export default {
    viewModel: ToggleSwitchViewModel,
    template: template
};
