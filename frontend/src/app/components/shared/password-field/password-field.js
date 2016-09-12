import template from './password-field.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils';

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

class PasswordFieldViewModel extends Disposable{
    constructor({ value, placeholder = '' }) {
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
    }

    toogleType() {
        this.type(this.type() === 'password' ? 'input' : 'password');
    }
}

export default {
    viewModel: PasswordFieldViewModel,
    template: template
};
