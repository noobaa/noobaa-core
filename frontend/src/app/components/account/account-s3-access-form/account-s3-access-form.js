import template from './account-s3-access-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { routeContext, systemInfo } from 'model';

class AccountS3AccessFormViewModel extends Disposable{
    constructor() {
        super();

        const account = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return { access_keys: [] };
                }

                const email = routeContext().params.account;
                return systemInfo().accounts.find(
                    account => account.email === email
                );
            }
        );

        this.email = ko.pureComputed(
            () => account().email
        );

        this.isS3AccessDisabled = ko.pureComputed(
            () => !account().has_s3_access
        );

        const allowedBuckets = ko.pureComputed(
            () => (account().allowed_buckets || []).join(', ') || '(none)'
        );

        this.s3AccessInfo = [
            {
                label: 'S3 Access',
                value: ko.pureComputed(
                    () => this.isS3AccessDisabled() ? 'Disabled' : 'Enabled'
                )
            },
            {
                label: 'Permitted buckets',
                value: allowedBuckets,
                disabled: this.isS3AccessDisabled
            }
        ];

        const keys = ko.pureComputed(
            () => account().access_keys[0] || {}
        );

        this.credentials = [
            {
                label: 'Access Key',
                value: ko.pureComputed( () => keys().access_key ),
                allowCopy: true,
                disabled: this.isS3AccessDisabled
            },
            {
                label: 'Secret Key',
                value: ko.pureComputed( () => keys().secret_key ),
                allowCopy: true,
                disabled: this.isS3AccessDisabled
            }
        ];

        this.isEditAccountS3AccessModalVisible = ko.observable(false);
        this.isRegenerateAccountCredentialsModalVisible = ko.observable(false);
    }

    showEditAccountS3AccessModal() {
        this.isEditAccountS3AccessModalVisible(true);
    }

    hideEditAccountS3AccessModal() {
        this.isEditAccountS3AccessModalVisible(false);
    }

    showRegenerateAccountCredentialsModal() {
        this.isRegenerateAccountCredentialsModalVisible(true);
    }

    hideRegenerateAccountCredentialsModal() {
        this.isRegenerateAccountCredentialsModalVisible(false);
    }
}

export default {
    viewModel: AccountS3AccessFormViewModel,
    template: template
};
