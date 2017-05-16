/* Copyright (C) 2016 NooBaa */

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
                    validator: () => this.touched() || resetPasswordState() !== 'UNAUTHORIZED',
                    message: 'Please make sure your password is correct'
                }
            });

        this.touched = ko.touched(this.password);
        this.isValidated = ko.observable(false);

        this.newPassword = ko.observable()
            .extend({
                minLength: {
                    params: 5,
                    message: 'Use at least 5 characters'
                },
                includesUppercase: true,
                includesLowercase: true,
                includesDigit: true
            });

        this.calcPasswordStrength = calcPasswordStrength;

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

        this.addToDisposeList(resetPasswordState.subscribe(
            state => state === 'SUCCESS' && refresh()
        ));

        this.errors = ko.validation.group(this);
    }

    change() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
            this.isValidated(true);

        } else {
            this.touched(false);
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
