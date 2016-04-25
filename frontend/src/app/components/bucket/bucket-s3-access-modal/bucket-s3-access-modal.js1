import template from './bucket-s3-access-modal.html';
import ko from 'knockout';
import { noop } from 'utils';
import { bucketS3ACL } from 'model';
import { loadBucketS3ACL, updateBucketS3ACL } from 'actions';

class BucketS3AccessModalViewModel {
    constructor({ bucketName, onClose = noop }) {
        this.onClose = onClose;

        this.bucketName = bucketName;

        this.accounts = bucketS3ACL
            .map(
                ({ account }) => account
            );

        this.selectedAccounts = ko.observableWithDefault(
            () => bucketS3ACL
                .filter(
                    ({ is_allowed }) => is_allowed
                )
                .map(
                    ({ account }) => account
                )
        );

        loadBucketS3ACL(ko.unwrap(this.bucketName));
    }

    selectAllAccounts() {
        this.selectedAccounts(
            Array.from(this.accounts())
        );
    }

    clearAllAccounts() {
        this.selectedAccounts([]);
    }

    save() {
        let acl = this.accounts().map(
            account => ({
                account: account,
                is_allowed: this.selectedAccounts().indexOf(account) !== -1
            })
        );

        updateBucketS3ACL(ko.unwrap(this.bucketName), acl);
        this.onClose();
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: BucketS3AccessModalViewModel,
    template: template
}