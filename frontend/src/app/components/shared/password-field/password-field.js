/* Copyright (C) 2016 NooBaa */

import template from './password-field.html';
import ko from 'knockout';
import { deepFreeze, isFunction } from 'utils/core-utils';

const iconMapping = deepFreeze({
    password: {
        icon: 'eye',
        tooltip: 'Show password'
    },
    text: {
        icon: 'no-eye',
        tooltip: 'Hide password'
    }
});

class PasswordFieldViewModel {
    constructor(params) {
        const {
            value,
            disabled,
            placeholder = '',
            hasFocus = ko.observable(false),
            strengthCalc
        } = params;

        this.value = value;
        this.disabled = disabled;
        this.type = ko.observable('password');
        this.placeholder = placeholder;
        this.hasFocus = hasFocus;

        this.icon = ko.pureComputed(() =>
            iconMapping[this.type()].icon
        );

        this.tooltip = ko.pureComputed(() =>
            iconMapping[this.type()].tooltip
        );

        this.strength = ko.pureComputed(() => {
            if (!isFunction(strengthCalc)) {
                return null;
            }

            const value = strengthCalc(ko.unwrap(this.value) || '');
            return {
                length: `${value * 100}%`,
                o1: Math.min(2 * value, 1),
                o2: Math.min(2 * (1 - value), 1)
            };
        });
    }

    toogleType() {
        this.type(this.type() === 'password' ? 'text' : 'password');
    }
}

export default {
    viewModel: PasswordFieldViewModel,
    template: template
};
