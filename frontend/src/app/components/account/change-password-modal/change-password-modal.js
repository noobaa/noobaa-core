import template from './change-password-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { calcPasswordStrength } from 'utils/password-utils';

class ChangePasswordModalViewModel extends Disposable {
    constructor({ email, onClose }) {
        super();

        this.onClose = onClose;
        this.email = email;

        this.password = ko.observable()
            .extend({
                required: { message: 'Please enter your current password' }
            });

        this.newPassword = ko.observable()
            .extend({
                required: { message: 'Please enter a new password' },
                minLength: 5,
                includesUppercase: true,
                includesLowercase: true,
                includesDigit: true
            });

        this.isNewPasswordValid = ko.pureComputed(
            () => this.newPassword() && this.newPassword.isValid()
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

        this.calcPasswordStrength = calcPasswordStrength;

        this.errors = ko.validation.group(this);
    }

    change() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: ChangePasswordModalViewModel,
    template: template
};
