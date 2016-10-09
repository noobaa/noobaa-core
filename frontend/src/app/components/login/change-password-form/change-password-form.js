import template from './change-password-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { updateAccountPassword } from 'actions';
import { sessionInfo } from 'model';
import { calcPasswordStrength } from 'utils';

class ChangePasswordFormViewModel extends Disposable{
    constructor() {
        super();

        this.newPassword = ko.observable()
            .extend({
                required: true,
                minLength: {
                    params: 5,
                    message: 'Use at least 5 characters'
                },
                includesUppercase: true,
                includesLowercase: true,
                includesDigit: true
            });

        this.calcPasswordStrength = calcPasswordStrength;

        this.isNewPasswordValid = ko.pureComputed(
            () => Boolean(this.newPassword()) && this.newPassword.isValid()
        ).extend({
            equal: {
                params: true,
                message: 'Please enter a valid password'
            },
            isModified: this.newPassword.isModified
        });

        this.newPasswordValidations = ko.pureComputed(
            () => ko.validation.fullValidationState(this.newPassword)()
                .filter(
                    validator => validator.rule !== 'required'
                )
                .map(
                    validator => ({
                        message: validator.message,
                        isValid: this.newPassword() && validator.isValid
                    })
                )
        );

        this.errors = ko.validation.group(this);

        this.shake = ko.observable(false);
    }

    change() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
            this.shake(true);
        } else {
            updateAccountPassword(sessionInfo().user, this.newPassword());
        }
    }
}

export default {
    viewModel: ChangePasswordFormViewModel,
    template: template
};
