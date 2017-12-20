/* Copyright (C) 2016 NooBaa */

import template from './radio-group.html';
import ko from 'knockout';
import { randomString } from 'utils/string-utils';

class RadioGroupViewModel {
    constructor({
            selected = ko.observable(),
            name = randomString(5),
            options = [],
            multiline = false,
            disabled = false,
            hasFocus = false
    }) {
        this.name = name;
        this.selected = selected;
        this.disabled = disabled;
        this.hasFocus = hasFocus;
        this.css = multiline ? 'multiline' : '';

        this.options = ko.pureComputed(
            () => ko.unwrap(options).map(
                opt => {
                    const { value = opt, label = value, tooltip } = opt;
                    const disabled = ko.unwrap(this.disabled) ||
                        ko.unwrap(opt.disabled) ||
                        false;

                    return { value, label, disabled, tooltip };
                }
            )
        );
    }
}

export default {
    viewModel: RadioGroupViewModel,
    template: template
};
