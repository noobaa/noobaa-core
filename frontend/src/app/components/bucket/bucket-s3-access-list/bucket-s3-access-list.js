import template from './bucket-s3-access-list.html';
import ko from 'knockout';
import { bucketS3ACL } from 'model';
import { loadBucketS3ACL } from 'actions';

class BucketS3AccessListViewModel {
    constructor({ bucketName }) {
        this.accessList = bucketS3ACL
            .filter(
                ({ is_allowed }) => is_allowed
            )
            .map(
                ({ account }) => account
            );

        this.selectedAccount = ko.observable();

        this.bucketName = bucketName;

        this.bucketNameSub = this.bucketName.subscribe(
            name => loadBucketS3ACL(name)
        );

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

    dispose() {
        this.bucketNameSub.dispose();
    }
}

export default {
    viewModel: BucketS3AccessListViewModel,
    template: template
}