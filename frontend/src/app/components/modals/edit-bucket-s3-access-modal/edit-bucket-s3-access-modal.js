/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-s3-access-modal.html';
import Observer from 'observer';
import ko from 'knockout';
import FormViewModel from 'components/form-view-model';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import { getMany } from 'rx-extensions';
import { action$, state$ } from 'state';
import { closeModal, updateBucketS3Access, updateForm } from 'action-creators';

const formName = 'editBucketS3Access';

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
    accountOptions = ko.observableArray();
    isFormInitialized = ko.observable();
    accountsHref = ko.observable();
    form = null;
    bucketName = '';

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);

        this.observe(
            state$.pipe(
                getMany(
                    'accounts',
                    ['location', 'params', 'system'],
                    ['forms', formName]
                )
            ),
            this.onState
        );
    }

    onState([accounts, system, form]) {
        if (!accounts) {
            this.isFormInitialized(false);
            return;
        }

        const accountList = Object.values(accounts);
        const accountOptions = accountList.map(_getAccountOption);

        if (!form) {
            const selectedAccounts = accountList
                .filter(account => account.allowedBuckets.includes(this.bucketName))
                .map(account => account.name);

            this.form = new FormViewModel({
                name: formName,
                fields: {
                    selectedAccounts: selectedAccounts

                },
                onSubmit: this.onSubmit.bind(this)
            });
            this.isFormInitialized(true);
        }

        this.accountsHref = realizeUri(routes.accounts, { system });
        this.accountOptions(accountOptions);
    }

    selectAllAccounts() {
        const selectedAccounts = this.accountOptions()
            .map(opt => opt.value);

        action$.next(updateForm(formName, { selectedAccounts }));
    }

    clearAllAccounts() {
        const selectedAccounts = this.accountOptions()
            .filter(opt => opt.disabled)
            .map(opt => opt.value);

        action$.next(updateForm(formName, { selectedAccounts }));
    }

    onSubmit(values) {
        action$.next(updateBucketS3Access(this.bucketName, values.selectedAccounts));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }

    dispose(){
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: EditBucketS3AccessModalViewModel,
    template: template
};
