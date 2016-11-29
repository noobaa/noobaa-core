import template from './edit-account-s3-access-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { updateAccountS3ACL } from 'actions';

class EditAccountS3AccessModalViewModel extends Disposable {
    constructor({ email, onClose }) {
        super();

        this.onClose = onClose;
        this.email = email;

        const account = ko.pureComputed(
            () => systemInfo() && systemInfo().accounts.find(
                account => account.email === ko.unwrap(email)
            )
        );

        this.buckets = ko.pureComputed(
            () => systemInfo().buckets.map(
                ({ name }) => name
            )
        );

        this.hasS3Access = ko.observableWithDefault(
            () => !!account() && account().has_s3_access
        );

        const _selectedBuckets = ko.observableWithDefault(
            () => Array.from(account().allowed_buckets || [])
        );

        this.selectedBuckets = ko.pureComputed({
            read: () => this.hasS3Access() ? _selectedBuckets() : [],
            write: val => _selectedBuckets(val)
        });
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
        const acl = this.buckets().map(
            bucketName => ({
                bucket_name: bucketName,
                is_allowed: this.selectedBuckets().includes(bucketName)
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
