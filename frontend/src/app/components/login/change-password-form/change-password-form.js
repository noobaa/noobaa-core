/* Copyright (C) 2016 NooBaa */

import template from './change-password-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { signOut } from 'action-creators';
import { sessionInfo, resetPasswordState } from 'model';
import { calcPasswordStrength } from 'utils/password-utils';
import { sleep } from 'utils/promise-utils';
import { action$ } from 'state';
import { changeAccountPassword, refreshLocation } from 'action-creators';
import { formatEmailUri } from 'utils/browser-utils';
import { support } from 'config';

class ChangePasswordFormViewModel extends BaseViewModel {
    constructor() {
        super();

        this.supportEmailHref = formatEmailUri(support.email);

        this.password = ko.observable()
            .extend({
                required: { message: 'Please enter your current password' },
                validation: {
                    validator: () => this.touched() || resetPasswordState() !== 'UNAUTHORIZED',
                    message: 'Please make sure your password is correct'
                }
            });

        this.isPasswordInvalid = ko.pureComputed(() => {
            const { password } = this;
            return password.isModified() && !password.isValid() && !password.isValidating();
        });

        this.touched = ko.touched(this.password);
        this.wasValidated = ko.observable(false);

        this.newPassword = ko.observable()
            .extend({
                required: true,
                minLength: {
                    params: 5,
                    message: 'At least 5 characters'
                },
                includesUppercase: true,
                includesLowercase: true,
                includesDigit: true
            });

        this.isNewPasswordInvalid = ko.pureComputed(() => {
            const { newPassword } = this;
            return newPassword.isModified() && !newPassword.isValid() && !newPassword.isValidating();
        });

        this.calcPasswordStrength = calcPasswordStrength;

        this.addToDisposeList(resetPasswordState.subscribe(
            state => state === 'SUCCESS' && action$.next(refreshLocation())
        ));

        this.errors = ko.validation.group(this);
    }

    async change() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
            this.wasValidated(true);

        } else {
            this.touched(false);
            action$.next(changeAccountPassword(
                this.password(),
                sessionInfo().user,
                this.newPassword(),
            ));

            // A workaround for the problem that the UI does not update after the
            // the password is reset which cause the user to be locked to the reset window
            // instead of moving on to the overview page.
            // A full fix will be issued with the tiering integarion merge.
            await sleep(1500);
            location.reload();
        }
    }

    back() {
        action$.next(signOut());
    }
}

export default {
    viewModel: ChangePasswordFormViewModel,
    template: template
};
