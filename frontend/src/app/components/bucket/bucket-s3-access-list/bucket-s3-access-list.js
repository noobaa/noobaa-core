import template from './bucket-s3-access-list.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';

class BucketS3AccessListViewModel extends BaseViewModel {
    constructor({ bucketName }) {
        super();

        this.accessList = ko.pureComputed(
            () => (systemInfo() ? systemInfo().accounts : [])
                .filter(
                    account => (account.allowed_buckets || [])
                        .includes(ko.unwrap(bucketName))
                )
                .map(
                    account => account.email
                )
        );

        this.isListEmpty = ko.pureComputed(
            () => this.accessList().length === 0
        );

        this.selectedAccount = ko.observable();

        this.bucketName = bucketName;

        this.isS3AccessModalVisible = ko.observable(false);
    }

    openS3AccessModal() {
        ko.unwrap(this.bucketName) && this.isS3AccessModalVisible(true);
    }

    closeS3AccessModal() {
        this.isS3AccessModalVisible(false);
    }

    openConnectionDetailsFor(email) {
        this.selectedAccount(email);
    }

    closeConnectionDetails() {
        this.selectedAccount(null);
    }
}

export default {
    viewModel: BucketS3AccessListViewModel,
    template: template
};
