/* Copyright (C) 2016 NooBaa */

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

        this.accountOptions = ko.pureComputed(
            () => (systemInfo() ? systemInfo().accounts : [])
                .filter(account => Boolean(account.allowed_buckets))
                .map(({ email, allowed_buckets }) => ({
                    value: email,
                    disabled: allowed_buckets.full_permission,
                    tooltip: allowed_buckets.full_permission ?
                        'Account has an allow all buckets access configured' :
                        email
                }))
        );

        this.selectedAccounts = ko.observableWithDefault(
            () => (systemInfo() ? systemInfo().accounts : [])
                .filter(({ allowed_buckets })=> {
                    if (!allowed_buckets) {
                        return false;
                    }

                    const { full_permission, permission_list } = allowed_buckets;
                    return full_permission || permission_list.includes(bucketName);
                })
                .map(account => account.email)
        );
    }

    selectAllAccounts() {
        const accounts = this.accountOptions()
            .map(opt => opt.value);

        this.selectedAccounts(accounts);
    }

    clearAllAccounts() {
        const accounts = this.accountOptions()
            .filter(x => x.disabled)
            .map(opt => opt.value);

        this.selectedAccounts(accounts);
    }

    onAccounts() {
        this.onClose();
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
