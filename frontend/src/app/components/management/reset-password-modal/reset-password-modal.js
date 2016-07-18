import template from './reset-password-modal.html';
import userMessageTemplate from './user-message-template.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { resetAccountPassword } from 'actions';
import { randomString, copyTextToClipboard } from 'utils';

const userMessage = new Function(
    'emailAddress',
    'password',
    'return `' + userMessageTemplate + '`'
);

class RestPasswordModalViewModel extends Disposable {
    constructor({ onClose, email }) {
        super();

        this.onClose = onClose;
        this.email = email;
        this.password = randomString();

        this.userMessage = ko.pureComputed(
             () => userMessage(
                 ko.unwrap(this.email),
                 this.password
             )
        );

    }

    reset() {
        copyTextToClipboard(this.userMessage());
        resetAccountPassword(ko.unwrap(this.email), this.password);
        this.onClose();
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: RestPasswordModalViewModel,
    template: template
};
