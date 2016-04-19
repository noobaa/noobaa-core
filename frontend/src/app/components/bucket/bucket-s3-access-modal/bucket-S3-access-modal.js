import template from './bucket-s3-access-modal.html';
import ko from 'knockout';
import { noop } from 'utils';
import { accountList, bucketS3AccessList } from 'model';
import { loadAccountList, loadBucketS3AccessList } from 'actions';

class BucketS3AccessModalViewModel {
    constructor({ bucketName, onClose = noop }) {
        this.onClose = onClose;

        this.accounts = accountList.map(
            account => account.email
        );

        this.selectedAccounts = ko.observableWithDefault(
            () => bucketS3AccessList()
        );

        loadAccountList()
        loadBucketS3AccessList(ko.unwrap(bucketName));
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