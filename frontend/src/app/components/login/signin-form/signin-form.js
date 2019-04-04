/* Copyright (C) 2016 NooBaa */

import template from './signin-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { loginInfo } from 'model';
import { action$ } from 'state';
import { signIn } from 'action-creators';
import { formatEmailUri } from 'utils/browser-utils';
import { support } from 'config';

class SignInFormViewModel extends BaseViewModel {
    constructor() {
        super();

        this.supportEmailHref = formatEmailUri(support.email);

        const email = ko.observable();
        this.email = ko.pureComputed({
            read: email,
            write: val => email(val.trim())
        })
            .extend({
                required: { message: 'Please enter an email address' },
                email: { message: 'Please enter a valid email address' }
            });

        this.isEmailInvalid = ko.pureComputed(() => {
            const { email } = this;
            return email.isModified() && !email.isValid() && !email.isValidating();
        });

        this.password = ko.observable()
            .extend({
                required: { message: 'Please enter a password' }
            });

        this.isPasswordInvalid = ko.pureComputed(() => {
            const { password } = this;
            return password.isModified() && !password.isValid() && !password.isValidating();
        });

        this.keepSessionAlive = ko.observable(false);

        let retryCount = ko.pureComputed(
            () => loginInfo().retryCount
        );

        this.isDirty = ko.observable(false);

        this.showInvalidMessage = ko.pureComputed(
            () => !this.isDirty() && retryCount() > 0
        );

        this.errors = ko.validation.group([
            this.email,
            this.password
        ]);
    }

    signIn() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            this.isDirty(false);
            action$.next(signIn(
                this.email(),
                this.password(),
                this.keepSessionAlive(),
            ));
        }
    }
}

export default {
    viewModel: SignInFormViewModel,
    template: template
};
