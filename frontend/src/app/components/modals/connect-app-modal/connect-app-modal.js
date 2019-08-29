/* Copyright (C) 2016 NooBaa */

import template from './connect-app-modal.html';
import ConnectableViewModel from 'components/connectable';
import { getFieldValue } from 'utils/form-utils';
import { deepFreeze } from 'utils/core-utils';
import ko from 'knockout';
import {
    openCreateAccountModal,
    closeModal
} from 'action-creators';

const endpointKindLabel = deepFreeze({
    EXTERNAL: 'Cluster External Name',
    INTERNAL: 'Cluster Internal Name'
});

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
    endpointOptions = ko.observableArray();
    accountActions = [{
        label: 'Create new account',
        onClick: () => this.onCreateNewAccount()
    }];
    details = [
        {
            label: 'Storage Type',
            value: 'S3 compatible storage'
        },
        {
            label: ko.observable(),
            value: ko.observable(),
            template: 'valueWithTooltip',
            allowCopy: true
        },
        {
            label: 'Access Key',
            value: ko.observable(),
            allowCopy: true
        },
        {
            label: 'Secret Key',
            value: ko.observable(),
            allowCopy: true
        }
    ];

    selectState(state) {
        const { accounts, system, location, session, forms } = state;
        return [
            accounts,
            system && system.s3Endpoints,
            location.hostname,
            session && session.user,
            forms[this.formName]
        ];
    }

    mapStateToProps(accounts, s3Endpoints, hostname, user, form) {
        if (!accounts || !s3Endpoints || !user) {
            return;
        }


        const accountList = Object.values(accounts).filter(account =>
            account.hasS3Access && !account.roles.includes('operator')
        );
        const accountOptions = accountList.map(account => account.name);
        const endpointOptions = s3Endpoints.map((endpoint, i) => ({
            value: i + 1,
            label: endpointKindLabel[endpoint.kind],
            remark: endpoint.address
        }));
        const { name: accountName, accessKeys } = _getSelectedAccount(accountList, user, form);
        const endpoint = s3Endpoints[form ? getFieldValue(form, 'selectedEndpoint') - 1 : 0];

        ko.assignToProps(this, {
            accountOptions,
            endpointOptions,
            details: [
                {},
                {
                    label: endpointKindLabel[endpoint.kind],
                    value: endpoint.address
                },
                {
                    value: accessKeys.accessKey
                },
                {
                    value: accessKeys.secretKey
                }
            ],
            fields: !form ? {
                selectedAccount: accountName,
                selectedEndpoint: 1
            } : undefined
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
