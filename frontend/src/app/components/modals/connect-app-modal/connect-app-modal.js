/* Copyright (C) 2016 NooBaa */

import template from './connect-app-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { getFieldValue } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';
import {
    openCreateAccountModal,
    closeModal
} from 'action-creators';

class ConnectAppModalViewModel extends Observer {
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

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'accounts',
                    ['location', 'hostname'],
                    ['forms', this.formName]
                )
            ),
            this.onState
        );
    }

    onState([accounts, hostname, form]) {
        if (!accounts) {
            return;
        }

        const accountList = Object.values(accounts)
            .filter(account => account.hasS3Access);
        const accountOptions = accountList.map(account => account.name);
        const { name: selectedAccount } = form ?
            accountList.find(account => account.name === getFieldValue(form, 'selectedAccount')) :
            accountList.find(account => account.isOwner);

        this.accountOptions(accountOptions);
        this.accessKey(accounts[selectedAccount].accessKeys.accessKey);
        this.secretKey(accounts[selectedAccount].accessKeys.secretKey);
        this.endpoint(hostname);

        if (!this.fields()) {
            this.fields({ selectedAccount });
        }
    }

    onCreateNewAccount() {
        action$.next(openCreateAccountModal());
    }

    onSubmit() {
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: ConnectAppModalViewModel,
    template: template
};
