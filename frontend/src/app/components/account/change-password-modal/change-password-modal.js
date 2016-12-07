import template from './change-password-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { calcPasswordStrength  } from 'utils/password-utils';
import { resetAccountPassword } from 'actions';
import { resetPasswordState } from 'model';

class ChangePasswordModalViewModel extends Disposable {
    constructor({ email, onClose }) {
        super();

        this.calcPasswordStrength = calcPasswordStrength;
        this.onClose = onClose;
        this.email = email;

        this.password = ko.observable()
            .extend({
                required: { message: 'Please enter your current password' },
                validation: {
                    validator: () => touched() || resetPasswordState() !== 'UNAUTHORIZED',
                    message: 'Please make sure your password is correct'
                }
            });

        this.newPassword = ko.observable()
            .extend({
                required: { message: 'Please enter a new password' },
                minLength: 5,
                includesUppercase: true,
                includesLowercase: true,
                includesDigit: true

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


        this.isNewPasswordValid = ko.pureComputed(
            () => this.newPassword.isValid()
        )
            .extend({
                equal: {
                    params: true,
                    message: 'Please enter a valid password'
                },
                isModified: this.newPassword.isModified
            });

        const touched = ko.touched([this.password]);
        this.addToDisposeList(
            resetPasswordState.subscribe(
                state => {
                    touched.reset();
                    if (state === 'SUCCESS' || state == 'ERROR') {
                        this.onClose();
                    }
                }
            )
        );

        this.errors = ko.validation.group(this);
    }

    change() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            resetAccountPassword(
                this.password(),
                ko.unwrap(this.email),
                this.newPassword(),
                false
            );
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
