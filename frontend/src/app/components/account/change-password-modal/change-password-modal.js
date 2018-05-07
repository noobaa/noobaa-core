/* Copyright (C) 2016 NooBaa */

import template from './change-password-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { calcPasswordStrength  } from 'utils/password-utils';
import { action$ } from 'state';
import { changeAccountPassword } from 'action-creators';
import { resetPasswordState } from 'model';

class ChangePasswordModalViewModel extends BaseViewModel {
    constructor({ email, onClose }) {
        super();

        this.calcPasswordStrength = calcPasswordStrength;
        this.onClose = onClose;
        this.email = email;

        this.password = ko.observable()
            .extend({
                required: { message: 'Please enter your current password' },
                validation: {
                    validator: () => this.touched() || resetPasswordState() !== 'UNAUTHORIZED',
                    message: 'Please make sure your password is correct'
                }
            });
        this.touched = ko.touched(this.password);
        this.wasValidated = ko.observable(false);

        this.newPassword = ko.observable()
            .extend({
                validation: {
                    validator: pass => pass && (pass.length >= 5),
                    message: 'Use at least 5 characters'
                },
                includesUppercase: true,
                includesLowercase: true,
                includesDigit: true
            });

        this.addToDisposeList(
            resetPasswordState.subscribe(
                state => {
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
            this.wasValidated(true);

        } else {
            this.touched(false);
            action$.next(changeAccountPassword(
                this.password(),
                ko.unwrap(this.email),
                this.newPassword(),
            ));
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
