import template from './create-account-wizard.html';
import nameAndPermissionsStepTemplate from './name-and-permissions-step.html';
import detailsStepTemplate from './details-step.html';
import ko from 'knockout';
import { randomString, copyTextToClipboard, generateAccessKeys } from 'utils';
import { systemInfo, accountList } from 'model';
import { createAccount } from 'actions';

function makeUserMessage(loginInfo, S3AccessInfo) {
    return `
<p>Hi, I created a NooBaa user for you:</p>
${makeLoginMessage(loginInfo)}<br>
${S3AccessInfo ? makeS3AccessMessage(S3AccessInfo) : ''}
    `;
}

function makeLoginMessage({ serverAddress, username, password }) {
    return `
<p>
Use the following credentials to connect to the NooBaa console:<br>
<span class="emphasized">Console Url:</span> ${serverAddress}<br>
<span class="emphasized">Username:</span> ${username}<br>
<span class="emphasized">Password:</span> ${password}
</p>
    `;
}

function makeS3AccessMessage({ access_key, secret_key }) {
    return `
<p class="paragraph">
Use the following S3 access to connect an S3 compatible application to NooBaa:<br>
<span class="emphasized">Access Key:</span> ${access_key}<br>
<span class="emphasized">Secret Key:</span> ${secret_key}
</p>
    `;
}

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

        this.buckets = ko.pureComputed(
            () => (systemInfo() ? systemInfo().buckets : []).map(
                ({ name }) => name
            )
        );

        let selectedBuckets = ko.observableArray();
        this.selectedBuckets = ko.pureComputed({
            read: () => this.enableS3Access() ? selectedBuckets() : [],
            write: selectedBuckets
        });

        this.password = randomString();
        this.accessKeys = generateAccessKeys();


        let loginInfo = ko.pureComputed(
            () => ({
                serverAddress: `https://${systemInfo().endpoint}:${systemInfo().ssl_port}`,
                username: this.emailAddress(),
                password: this.password
            })
        );

        this.userMessage = ko.pureComputed(
            () => makeUserMessage(
                loginInfo(),
                this.enableS3Access() ? this.accessKeys : null
            )
        );

        this.nameAndPermissionsErrors = ko.validation.group([
            this.emailAddress
        ]);
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

    clearAllBuckets() {
        this.selectedBuckets([]);
    }

    copyCreateEmailToClipboard() {


    }

    create() {
        createAccount(
            systemInfo().name,
            this.emailAddress(),
            this.password,
            this.accessKeys,
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
