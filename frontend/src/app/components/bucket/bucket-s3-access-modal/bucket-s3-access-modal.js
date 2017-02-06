import template from './bucket-s3-access-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { noop } from 'utils/core-utils';
import { updateBucketS3Access } from 'actions';
import { systemInfo } from 'model';

class BucketS3AccessModalViewModel extends BaseViewModel {
    constructor({ bucketName, onClose = noop }) {
        super();

        this.onClose = onClose;
        this.bucketName = bucketName;

        this.accounts = ko.pureComputed(
            () => (systemInfo() ? systemInfo().accounts : [])
                .filter(
                    account => Boolean(account.allowed_buckets)
                )
                .map(
                    account => account.email
                )
        );

        this.selectedAccounts = ko.observableWithDefault(
            () => (systemInfo() ? systemInfo().accounts : [])
                .filter(
                    account => (account.allowed_buckets || [])
                        .includes(ko.unwrap(bucketName))
                )
                .map(
                    account => account.email
                )
        );
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
        updateBucketS3Access(ko.unwrap(this.bucketName), this.selectedAccounts());
        this.onClose();
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: BucketS3AccessModalViewModel,
    template: template
};
