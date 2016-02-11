import template from './create-account-modal.html';
import userMessageTemplate from './user-message-template.html';
import ko from 'knockout';
import { systemInfo } from 'model';
import { randomString, copyTextToClipboard } from 'utils';
import { createAccount } from 'actions';

const userMessage = new Function(
    'serverAddress', 
    'emailAddress', 
    'password', 
    'return `' + userMessageTemplate + '`'
);

class CreateAccountModalViewModel {
    constructor({ onClose }) {
        this.onClose = onClose;

        this.emailAddress = ko.observable()
            .extend({ 
                required: { message: 'Please enter a valid email address' },
                email: true
            });

        this.password = randomString();
        
        this.userMessage = ko.pureComputed(
             () => userMessage(
                 `https://${systemInfo().endpoint}:${systemInfo().sslPort}`,
                 this.emailAddress() || '', 
                 this.password
             )
        );

        this.errors = ko.validation.group({
            emailAddress: this.emailAddress
        });
    }

    create() {
        if (this.errors().length === 0) {
            copyTextToClipboard(this.userMessage());
            createAccount(systemInfo().name, this.emailAddress(), this.password);
            this.onClose();    

        } else {
            this.errors.showAllMessages();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: CreateAccountModalViewModel,
    template: template
}