import template from './create-account-wizard.html';
import nameAndPermissionsStepTemplate from './name-and-permissions-step.html';
import detailsStepTemplate from './details-step.html';
import userMessageTemplate from './user-message-template.html';
import ko from 'knockout';
import { randomString, copyToClipboard } from 'utils';

const makeUserMessage = new Function(
    'serverAddress', 'emailAddress','password',
    'return `' + userMessageTemplate + '`'
);

class CreateAccountWizardViewModel {
    constructor({ onClose }) {
        this.onClose = onClose;
        this.nameAndPermissionsStepTemplate = nameAndPermissionsStepTemplate;
        this.detailsStepTemplate = detailsStepTemplate;

        this.emailAddress = ko.observable()
            .extend({ 
                required: { message: 'Please enter a valid email address' },
                email: true
            });

        this.enableS3Access = ko.observable(false);

        this.buckets = [
            'aasdasd', 'b3123123', 'casdasdsad', 'dasd123qsad', 'easdasd'
        ];

        let selectedBuckets = ko.observableArray();
        this.selectedBuckets = ko.pureComputed({
            read: () => this.enableS3Access() ? selectedBuckets() : [],
            write: selectedBuckets
        });

        this.password = randomString();

        this.userMessage = ko.pureComputed(
             () => makeUserMessage(
                 //`https://${systemInfo().endpoint}:${systemInfo().sslPort}`,
                 'blblabla',
                 this.emailAddress() || '', 
                 this.password
             )
        );

        this.nameAndPermissionsErrors = ko.validation.group({
            email: this.emailAddress
        });
    }

    validateStep(step) {
        switch (step) {
            case 1: 
                if (this.nameAndPermissionsErrors().length > 0) {
                    this.nameAndPermissionsErrors.showAllMessages();
                    return false;
                }
                break;
        }

        return true;
    }

    selectAllBuckets() {
        this.selectedBuckets(
            Array.from(this.buckets)
        );
    }

    clearBuckets() {
        this.selectedBuckets([]);
    }

    create() {
        copyTextToClipboard(this.userMessage());
        //createAccount(systemInfo().name, this.emailAddress(), this.password);
        this.onClose();

    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: CreateAccountWizardViewModel,
    template: template
};