import template from './edit-account-s3-access-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo, accountS3ACL } from 'model';
import { loadAccountS3ACL, updateAccountS3ACL } from 'actions';

class EditAccountS3AccessModalViewModel extends Disposable {
    constructor({ email, onClose }) {
        super();

        this.onClose = onClose;
        this.email = email;

        this.buckets = accountS3ACL
            .map(
                ({ bucket_name }) => bucket_name
            );

        let account = ko.pureComputed(
            () => systemInfo() && systemInfo().accounts.find(
                account => account.email === ko.unwrap(email)
            )
        );

        let selectedBucketsInternal = ko.observableWithDefault(
            () => accountS3ACL
                .filter(
                    ({ is_allowed }) => is_allowed
                )
                .map(
                    ({ bucket_name }) => bucket_name
                )
        );

        this.selectedBuckets = ko.pureComputed({
            read: () => this.hasS3Access() ? selectedBucketsInternal() : [],
            write: selectedBucketsInternal
        });

        this.hasS3Access = ko.observableWithDefault(
            () => !!account() && account().has_s3_access
        );

        loadAccountS3ACL(ko.unwrap(email));
    }

    selectAllBuckets() {
        this.selectedBuckets(
            Array.from(this.buckets())
        );

    }

    clearAllBuckets() {
        this.selectedBuckets([]);
    }

    save() {
        let acl = this.buckets().map(
            bucketName => ({
                bucket_name: bucketName,
                is_allowed: this.selectedBuckets().indexOf(bucketName) !== -1
            })
        );

        updateAccountS3ACL(
            ko.unwrap(this.email),
            this.hasS3Access() ? acl : null
        );
        this.onClose();
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: EditAccountS3AccessModalViewModel,
    template: template
};
