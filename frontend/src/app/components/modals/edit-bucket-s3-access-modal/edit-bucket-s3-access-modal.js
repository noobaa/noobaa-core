/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-s3-access-modal.html';
import Observer from 'observer';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import { getMany } from 'rx-extensions';
import { action$, state$ } from 'state';
import { closeModal, updateBucketS3Access, updateForm } from 'action-creators';

function _getAccountOption({ name, hasAccessToAllBuckets }) {
    return {
        value: name,
        disabled: hasAccessToAllBuckets,
        tooltip: hasAccessToAllBuckets ?
            'This account access permissions is set to “all buckets” and cannot be edited' :
            name
    };
}

class EditBucketS3AccessModalViewModel extends Observer {
    formName = this.constructor.name;
    fields = ko.observable();
    accountOptions = ko.observableArray();
    accountsHref = ko.observable();
    bucketName = '';

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);

        this.observe(
            state$.pipe(
                getMany(
                    'accounts',
                    ['location', 'params', 'system']
                )
            ),
            this.onState
        );
    }

    onState([accounts, system]) {
        if (!accounts) {
            return;
        }

        const accountList = Object.values(accounts);
        const accountOptions = accountList.map(_getAccountOption);

        this.accountsHref = realizeUri(routes.accounts, { system });
        this.accountOptions(accountOptions);

        if (!this.fields()) {
            const selectedAccounts = accountList
                .filter(account => account.allowedBuckets.includes(this.bucketName))
                .map(account => account.name);

            this.fields({ selectedAccounts });
        }
    }

    selectAllAccounts() {
        const selectedAccounts = this.accountOptions()
            .map(opt => opt.value);

        action$.next(updateForm(this.formName, { selectedAccounts }));
    }

    clearAllAccounts() {
        const selectedAccounts = this.accountOptions()
            .filter(opt => opt.disabled)
            .map(opt => opt.value);

        action$.next(updateForm(this.formName, { selectedAccounts }));
    }

    onSubmit(values) {
        action$.next(updateBucketS3Access(this.bucketName, values.selectedAccounts));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }

}

export default {
    viewModel: EditBucketS3AccessModalViewModel,
    template: template
};
