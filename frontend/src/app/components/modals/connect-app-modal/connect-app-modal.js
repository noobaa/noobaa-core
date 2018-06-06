/* Copyright (C) 2016 NooBaa */

import template from './connect-app-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { realizeUri } from 'utils/browser-utils';
import { getFieldValue } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
import ko from 'knockout';
import * as routes from 'routes';
import { closeModal } from 'action-creators';

class ConnectAppModalViewModel extends Observer {
    formName = this.constructor.name;
    fields = ko.observable();
    accountsSettingsHref = ko.observable();
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
                    'location',
                    ['forms', this.formName]
                )
            ),
            this.onAccount
        );
    }

    onAccount([accounts, location, form]) {
        if (!accounts) {
            return;
        }

        const { params, hostname } = location;
        const accountList = Object.values(accounts)
            .filter(account => account.hasS3Access);
        this.accountOptions = accountList.map(account => account.name);
        const { name: selectedAccount } = form ?
            accountList.find(account => account.name === getFieldValue(form, 'selectedAccount')) :
            accountList.find(account => account.isOwner);

        this.accessKey(accounts[selectedAccount].accessKeys.accessKey);
        this.secretKey(accounts[selectedAccount].accessKeys.secretKey);
        this.endpoint(hostname);
        this.accountsSettingsHref(
            realizeUri(
                routes.accounts,
                {
                    system: params.system,
                    tab: 'accounts'
                }
            )
        );

        if (!this.fields()) {
            this.fields({ selectedAccount });
        }
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
