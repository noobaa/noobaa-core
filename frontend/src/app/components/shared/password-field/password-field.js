/* Copyright (C) 2016 NooBaa */

import template from './password-field.html';
import ko from 'knockout';
import { deepFreeze, isFunction } from 'utils/core-utils';
import { tweenColors } from 'utils/color-utils';
import style from 'style';

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

const barTweenDuration = 250;

class PasswordFieldViewModel {
    constructor({ value, disabled, placeholder = '', strengthCalc}) {
        this.value = value;
        this.disabled = disabled;
        this.type = ko.observable('password');
        this.placeholder = placeholder;
        this.hasFocus = ko.observable();

        this.icon = ko.pureComputed(
            () => iconMapping[this.type()].icon
        );

        this.tooltip = ko.pureComputed(
            () => iconMapping[this.type()].tooltip
        );

        this.isStrengthVisible = isFunction(strengthCalc);
        this.passwordStrength = ko.pureComputed (
            () => {
                let naked = ko.unwrap(value);
                return (this.isStrengthVisible && naked) ? strengthCalc(naked) : 0;
            }
        ).extend({
            tween: {
                duration: barTweenDuration,
                easing: 'linear'
            }
        });

        let passwordStrengthColor = ko.pureComputed(
            () => tweenColors(
                this.passwordStrength(),
                style['color10'],
                style['color11'],
                style['color12']
            )
        );

        this.barValues = [
            {
                value: this.passwordStrength,
                color: passwordStrengthColor
            },
            {
                value: ko.pureComputed(
                    () => 1 - this.passwordStrength()
                ),
                color: 'transparent'
            }
        ];

        this.emptyColor = 'transparent';
    }

    toogleType() {
        this.type(this.type() === 'password' ? 'text' : 'password');
    }
}

export default {
    viewModel: PasswordFieldViewModel,
    template: template
};
