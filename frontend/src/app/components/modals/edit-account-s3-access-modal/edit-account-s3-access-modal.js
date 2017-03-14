import template from './edit-account-s3-access-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { updateAccountS3Access } from 'actions';

class EditAccountS3AccessModalViewModel extends BaseViewModel {
    constructor({ accountEmail, onClose }) {
        super();

        this.onClose = onClose;
        this.accountEmail = accountEmail;

        const account = ko.pureComputed(
            () => systemInfo() && systemInfo().accounts.find(
                account => account.email === ko.unwrap(accountEmail)
            )
        );

        this.buckets = ko.pureComputed(
            () => systemInfo().buckets.map(bucket => bucket.name)
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
        updateAccountS3Access(
            ko.unwrap(this.accountEmail),
            this.hasS3Access() ? this.selectedBuckets() : null
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
