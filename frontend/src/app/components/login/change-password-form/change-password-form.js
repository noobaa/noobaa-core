import template from './change-password-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { resetAccountPassword, signOut, refresh } from 'actions';
import { sessionInfo, resetPasswordState } from 'model';
import { calcPasswordStrength } from 'utils/password-utils';

class ChangePasswordFormViewModel extends BaseViewModel {
    constructor() {
        super();

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
                message: 'Please enter a valid new password'
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

        const touched = ko.touched([this.password]);
        this.addToDisposeList(
            resetPasswordState.subscribe(
                state => {
                    touched.reset();
                    if (state === 'SUCCESS') {
                        refresh();
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
                sessionInfo().user,
                this.newPassword(),
                false,
                true
            );
        }
    }

    back() {
        signOut();
    }
}

export default {
    viewModel: ChangePasswordFormViewModel,
    template: template
};
