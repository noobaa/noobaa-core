import template from './password-field.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze, isFunction, tweenColors } from 'utils';
import style from 'style';

const iconMapping = deepFreeze({
    password: {
        icon: 'eye',
        tooltip: 'Show password'
    },
    input: {
        icon: 'no-eye',
        tooltip: 'Hide password'
    }
});

const barTweenDuration = 250;

class PasswordFieldViewModel extends Disposable{
    constructor({ value, placeholder = '', strengthCalc}) {
        super();

        this.value = value;
        this.type = ko.observable('password');
        this.placeholder = placeholder;

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
                return (this.isStrengthVisible && naked ? strengthCalc(naked) : 0 );
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
        this.type(this.type() === 'password' ? 'input' : 'password');
    }
}

export default {
    viewModel: PasswordFieldViewModel,
    template: template
};
