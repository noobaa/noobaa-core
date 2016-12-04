import template from './reset-password-modal.html';
import passwordResetMessageTemplate from './password-reset-message.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { resetAccountPassword } from 'actions';
import { resetPasswordState } from 'model';
import { deepFreeze, randomString } from 'utils/all';

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

class RestPasswordModalViewModel extends Disposable {
    constructor({ onClose, email }) {
        super();

        this.onClose = onClose;
        this.email = email;
        this.password = randomString();

        this.verificationPassword = ko.observable()
            .extend({
                required: { message: 'Please enter your current password' },
                validation: {
                    validator: () => touched() || resetPasswordState() !== 'UNAUTHORIZED',
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

        const touched = ko.touched([this.verificationPassword]);

        this.screen = ko.observable(0);
        this.addToDisposeList(
            resetPasswordState.subscribe(
                state => {
                    touched.reset();
                    if (state === 'SUCCESS'){
                        this.screen(1);
                    } else if (state == 'ERROR') {
                        this.screen(2);
                    }
                }
            )
        );
    }

    reset() {
        if (this.errors().length) {
            this.errors.showAllMessages();
        } else {
            resetAccountPassword(
                this.verificationPassword(),
                ko.unwrap(this.email),
                this.password,
                true
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
