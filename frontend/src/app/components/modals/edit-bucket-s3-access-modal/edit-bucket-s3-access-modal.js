/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-s3-access-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
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

function _getSelectedAccounts(accountList, bucketName) {
    return accountList
        .filter(account => account.allowedBuckets.includes(bucketName))
        .map(account => account.name);
}

class EditBucketS3AccessModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    bucketName = '';
    accountsHref = ko.observable();
    accountOptions = ko.observableArray();
    fields = ko.observable();

    selectState(state, params) {
        const { accounts, location, forms } = state;
        return [
            params.bucketName,
            accounts,
            location.params.system,
            forms && forms[this.formName]
        ];
    }

    mapStateToProps(bucketName, accounts, system, form) {
        if (!accounts) {
            return;
        }

        const accountList = Object.values(accounts);

        ko.assignToProps(this, {
            bucketName,
            accountsHref: realizeUri(routes.accounts, { system }),
            accountOptions: accountList.map(_getAccountOption),
            fields: !form ? {
                selectedAccounts: _getSelectedAccounts(accountList, bucketName)
            } : undefined
        });
    }

    selectAllAccounts() {
        const selectedAccounts = this.accountOptions()
            .map(opt => opt.value);

        this.dispatch(updateForm(this.formName, { selectedAccounts }));
    }

    clearAllAccounts() {
        const selectedAccounts = this.accountOptions()
            .filter(opt => opt.disabled)
            .map(opt => opt.value);

        this.dispatch(updateForm(this.formName, { selectedAccounts }));
    }

    onSubmit(values) {
        this.dispatch(
            closeModal(),
            updateBucketS3Access(this.bucketName, values.selectedAccounts)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }

}

export default {
    viewModel: EditBucketS3AccessModalViewModel,
    template: template
};
