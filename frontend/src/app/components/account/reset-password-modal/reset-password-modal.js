import template from './reset-password-modal.html';
import userMessageTemplate from './user-message-template.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { resetPasswordState } from 'model';
import { resetAccountPassword } from 'actions';
import { deepFreeze, randomString } from 'utils/all';

//const artificalResetDuration = 1000;

const screenTitleMapping = deepFreeze({
    0: {
        title: 'Reset Account Password'
    },
    1: {
        title: 'Password Reset Successfull',
        severity: 'success'
    },
    2: {
        title: 'Password Reset Failed',
        severity: 'error'
    }
});

const userMessage = new Function(
    'email',
    'password',
    'return `' + userMessageTemplate + '`'
);

class RestPasswordModalViewModel extends Disposable {
    constructor({ onClose, email }) {
        super();

        this.onClose = onClose;
        this.email = email;
        this.password = randomString();

        let resetState = ko.observable();
        this.addToDisposeList(
            resetPasswordState.subscribe(resetState)
        );

        this.resetting = ko.pureComputed(
            () => resetState() === 'RESETTING'
        );

        let isUnauthorized = ko.pureComputed(
            () => resetState() === 'UNAUTHORIZED'
        );

        this.verificationPassword = ko.observable()
            .extend({
                required: { message: 'A verification password is required' },
                validation: {
                    validator: () => !isUnauthorized(),
                    message: 'Invalid verification password'
                }
            });

        this.screen = ko.pureComputed(
            () => {
                let state = resetState();
                if (!state || this.resetting() || isUnauthorized() ) {
                    return 0;
                }

                return state === 'OK' ? 1 : 2;
            }
        );

        this.title = ko.pureComputed(
            () => screenTitleMapping[this.screen()].title
        );

        this.severity = ko.pureComputed(
            () => screenTitleMapping[this.screen()].severity
        );

        this.userMessage = ko.pureComputed(
             () => userMessage(
                 ko.unwrap(this.email),
                 this.password
             )
        );

        this.errors = ko.validation.group(this);
    }

    reset() {
        if (this.errors().length) {
            this.errors.showAllMessages();
        }

        if (this.verificationPassword()) {
            resetAccountPassword(
                this.verificationPassword(),
                ko.unwrap(this.email),
                this.password
            );
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
