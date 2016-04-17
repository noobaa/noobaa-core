import template from './create-account-wizard.html';
import nameAndPermissionsStepTemplate from './name-and-permissions-step.html';
import detailsStepTemplate from './details-step.html';
import userMessageTemplate from './user-message-template.html';
import ko from 'knockout';
import { randomString, copyTextToClipboard } from 'utils';
import { systemInfo, bucketList, accountList } from 'model';
import { loadBucketList, createAccount } from 'actions';

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
                required: { message: 'Please enter an email address' },
                email: { message: 'Please enter a valid email address' },
                notIn: {
                    params: accountList.map( ({ email }) => email ),
                    message: 'An account with the same email address already exists'
                }
            });

        this.enableS3Access = ko.observable(false);

        this.buckets = bucketList.map(
            bucket => bucket.name
        );

        let selectedBuckets = ko.observableArray();
        this.selectedBuckets = ko.pureComputed({
            read: () => this.enableS3Access() ? selectedBuckets() : [],
            write: selectedBuckets
        });

        this.password = randomString();

        this.userMessage = ko.pureComputed(
             () => makeUserMessage(
                 `https://${systemInfo().endpoint}:${systemInfo().sslPort}`,
                 this.emailAddress() || '', 
                 this.password
             )
        );

        let existingAccounts = accountList.map(
            ({ email }) => email
        );

        this.nameAndPermissionsErrors = ko.validation.group({
            email: this.emailAddress
        });

        loadBucketList();
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
            Array.from(this.buckets())
        );
    }

    clearBuckets() {
        this.selectedBuckets([]);
    }

    create() {
        createAccount(
            systemInfo().name, 
            this.emailAddress(), 
            this.password, 
            this.enableS3Access() ? this.selectedBuckets() : undefined
        );

        copyTextToClipboard(this.userMessage());

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