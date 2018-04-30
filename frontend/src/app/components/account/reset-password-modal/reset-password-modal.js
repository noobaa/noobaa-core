/* Copyright (C) 2016 NooBaa */

import template from './reset-password-modal.html';
import passwordResetMessageTemplate from './password-reset-message.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { resetPasswordState } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { randomString } from 'utils/string-utils';
import { action$ } from 'state';
import { changeAccountPassword } from 'action-creators';

const screenTitleMapping = deepFreeze({
    0: {
        title: 'Reset Account Password'
    },
    1: {
        title: 'Password Reset Successful',
        severity: 'success'
    },
    2: {
        title: 'Password Reset Failed',
        severity: 'error'
    }
});

class RestPasswordModalViewModel extends BaseViewModel {
    constructor({ onClose, email }) {
        super();

        this.onClose = onClose;
        this.email = email;
        this.password = randomString();

        const isAsyncValidationStale = ko.observable(true);

        this.verificationPassword = ko.observable()
            .extend({
                required: { message: 'Please enter your current password' },
                validation: {
                    validator: () => isAsyncValidationStale() ||
                        resetPasswordState() !== 'UNAUTHORIZED',
                    message: 'Please make sure your password is correct'
                }
            });

        this.title = ko.pureComputed(
            () => screenTitleMapping[this.screen()].title
        );

        this.severity = ko.pureComputed(
            () => screenTitleMapping[this.screen()].severity
        );

        this.userMessage = ko.pureComputed(
            () => ko.renderToString(
                passwordResetMessageTemplate,
                { email: ko.unwrap(this.email), password: this.password }
            )
        );

        this.errors = ko.validation.group(this);
        this.screen = ko.observable(0);

        this.addToDisposeList(
            resetPasswordState.subscribe(
                state => {
                    isAsyncValidationStale(false);
                    if (state === 'SUCCESS'){
                        this.screen(1);
                    } else if (state == 'ERROR') {
                        this.screen(2);
                    }
                }
            )
        );

        this.addToDisposeList(
            this.verificationPassword.subscribe(
                () => isAsyncValidationStale(true)
            )
        );
    }

    reset() {
        if (this.errors().length) {
            this.errors.showAllMessages();
        } else {
            action$.onNext(changeAccountPassword(
                this.verificationPassword(),
                ko.unwrap(this.email),
                this.password,
                true
            ));
        }
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: RestPasswordModalViewModel,
    template: template
};
