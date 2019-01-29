/* Copyright (C) 2016 NooBaa */

import template from './connect-app-modal.html';
import ConnectableViewModel from 'components/connectable';
import { getFieldValue } from 'utils/form-utils';
import ko from 'knockout';
import {
    openCreateAccountModal,
    closeModal
} from 'action-creators';

class ConnectAppModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    fields = ko.observable();
    accountOptions = ko.observableArray();
    accountActions = [{
        label: 'Create new account',
        onClick: this.onCreateNewAccount
    }];
    accessKey = ko.observable();
    secretKey = ko.observable();
    endpoint = ko.observable();
    details = [
        {
            label: 'Storage Type',
            value: 'S3 compatible storage'
        },
        {
            label: 'REST Endpoint',
            value: this.endpoint,
            allowCopy: true
        },
        {
            label: 'Access Key',
            value: this.accessKey,
            allowCopy: true
        },
        {
            label: 'Secret Key',
            value: this.secretKey,
            allowCopy: true
        }
    ];

    selectState(state) {
        const { accounts, location, forms } = state;
        return [
            accounts,
            location.hostname,
            forms[this.formName]
        ];
    }

    mapStateToProps(accounts, hostname, form) {
        if (!accounts) {
            return;
        }

        const accountList = Object.values(accounts)
            .filter(account => account.hasS3Access);
        const accountOptions = accountList.map(account => account.name);
        const { name: selectedAccount } = form ?
            accountList.find(account => account.name === getFieldValue(form, 'selectedAccount')) :
            accountList.find(account => account.isOwner);

        ko.assignToProps(this, {
            accountOptions: accountOptions,
            accessKey: accounts[selectedAccount].accessKeys.accessKey,
            secretKey: accounts[selectedAccount].accessKeys.secretKey,
            endpoint: hostname,
            fields: !form ?
                { selectedAccount } :
                undefined
        });
    }

    onCreateNewAccount() {
        this.dispatch(openCreateAccountModal());
    }

    onSubmit() {
        this.dispatch(closeModal());
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: ConnectAppModalViewModel,
    template: template
};
