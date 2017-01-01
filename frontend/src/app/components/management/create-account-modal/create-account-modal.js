import template from './create-account-modal.html';
import createScreenTemplate from './create-screen.html';
import reviewScreenTemplate from './review-screen.html';
import newAccountMessageTemplate from './new-account-message.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { sleep } from 'utils/promise-utils';
import { randomString } from 'utils/string-utils';
import { systemInfo, createAccountState } from 'model';
import { createAccount } from 'actions';

const modalScreenMapping = deepFreeze({
    0: {
        title: 'Create Account',
        css: 'modal-medium'
    },
    1: {
        title: 'Account Created Successfully',
        severity: 'success',
        css: 'modal-small'
    }
});

class CreateAccountWizardViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
        this.createScreenTemplate = createScreenTemplate;
        this.reviewScreenTemplate = reviewScreenTemplate;
        this.newAccountMessageTemplate = newAccountMessageTemplate;
        this.screen = ko.observable(0);
        this.working = ko.observable(false);
        this.modalInfo = ko.pureComputed(
            () => modalScreenMapping[this.screen()]
        );

        const accounts = ko.pureComputed(
            () => (systemInfo() ? systemInfo().accounts : []).map(
                account => account.email
            )
        );

        this.emailAddress = ko.observable()
            .extend({
                required: {
                    onlyIf: () => !this.working(),
                    message: 'Please enter an email address'
                },
                email: {
                    onlyIf: () => !this.working(),
                    message: 'Please enter a valid email address'
                },
                notIn: {
                    onlyIf: () => !this.working(),
                    params: accounts,
                    message: 'An account with the same email address already exists'
                }
            });

        this.enableS3Access = ko.observable(false);

        this.buckets = ko.pureComputed(
            () => (systemInfo() ? systemInfo().buckets : []).map(
                ({ name }) => name
            )
        );

        const selectedBuckets = ko.observableArray();
        this.selectedBuckets = ko.pureComputed({
            read: () => this.enableS3Access() ? selectedBuckets() : [],
            write: selectedBuckets
        });

        this.password = randomString();

        this.userMessage = ko.pureComputed(
            () => {
                const { accounts = [], endpoint, ssl_port } = systemInfo();
                const account = accounts.find( account => account.email === this.emailAddress() );
                const access_keys = account && account.access_keys[0];

                const data = {
                    serverAddress: `https://${endpoint}:${ssl_port}`,
                    username: this.emailAddress(),
                    password: this.password,
                    accessKey: this.enableS3Access() ? access_keys.access_key : '',
                    secretKey: this.enableS3Access() ? access_keys.secret_key : ''
                };

                return ko.renderToString(newAccountMessageTemplate, data);
            }
        );

        this.errors = ko.validation.group([
            this.emailAddress
        ]);

        this.addToDisposeList(
            createAccountState.subscribe(
                status => {
                    switch(status) {
                        case 'IN_PROGRESS':
                            this.working(true);
                            break;

                        case 'SUCCESS':
                            sleep(500).then(
                                () => {
                                    this.working(false);
                                    this.screen(1);
                                }
                            );
                            break;

                        case 'ERROR':
                            this.onClose();
                            break;
                    }
                }
            )
        );
    }


    selectAllBuckets() {
        this.selectedBuckets(
            Array.from(this.buckets())
        );
    }

    clearAllBuckets() {
        this.selectedBuckets([]);
    }

    create() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            createAccount(
                this.emailAddress(),
                this.password,
                this.enableS3Access() ? this.selectedBuckets() : undefined
            );
        }
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: CreateAccountWizardViewModel,
    template: template
};
