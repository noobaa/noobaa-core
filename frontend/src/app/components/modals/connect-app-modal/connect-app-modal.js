/* Copyright (C) 2016 NooBaa */

import template from './connect-app-modal.html';
import ConnectableViewModel from 'components/connectable';
import { getFieldValue } from 'utils/form-utils';
import ko from 'knockout';
import {
    openCreateAccountModal,
    closeModal
} from 'action-creators';

function _getSelectedAccount(accountsWithS3Access, user, form) {
    if (form) {
        return accountsWithS3Access.find(account =>
            account.name === getFieldValue(form, 'selectedAccount')
        );
    }

    // return the user account if it have s3 acceess.
    const userAccount = accountsWithS3Access.find(account =>
        account.name === user
    );
    if (userAccount) {
        return userAccount;
    }

    // Return the first user with s3 access.
    return accountsWithS3Access[0];
}

class ConnectAppModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    fields = ko.observable();
    accountOptions = ko.observableArray();
    accountActions = [{
        label: 'Create new account',
        onClick: () => this.onCreateNewAccount()
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
            template: 'valueWithTooltip',
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
        const { accounts, location, session, forms } = state;
        return [
            accounts,
            location.hostname,
            session && session.user,
            forms[this.formName]
        ];
    }

    mapStateToProps(accounts, hostname, user, form) {
        if (!accounts || !user) {
            return;
        }

        const accountList = Object.values(accounts)
            .filter(account =>
                account.hasS3Access &&
                account.roles.every(role => role !== 'operator')
            );
        const accountOptions = accountList.map(account => account.name);
        const account = _getSelectedAccount(accountList, user, form);

        ko.assignToProps(this, {
            accountOptions: accountOptions,
            accessKey: account.accessKeys.accessKey,
            secretKey: account.accessKeys.secretKey,
            endpoint: hostname,
            fields: !form ?
                { selectedAccount: account.name } :
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
