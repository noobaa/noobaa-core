/* Copyright (C) 2016 NooBaa */

import template from './connect-app-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$ } from 'state';
import { realizeUri } from 'utils/browser-utils';
import { getFieldValue } from 'utils/form-utils';
import ko from 'knockout';
import * as routes from 'routes';

const formName = 'connectApp';

class ConnectAppModalViewModel extends Observer {
    constructor({ onClose }) {
        super();

        this.close = onClose;
        this.isFormInitialized = ko.observable();
        this.form = null;
        this.accountsSettingsHref = ko.observable();
        this.accessKey = ko.observable();
        this.secretKey = ko.observable();
        this.endpoint = ko.observable();
        this.details = [
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

        this.observe(state$.getMany(
            'accounts',
            'location',
            ['forms', formName]
        ), this.onAccount);
    }

    onAccount([accounts, location, form]) {
        if(!accounts) {
            this.isFormInitialized(false);
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

        if (!this.isFormInitialized()) {
            this.form = new FormViewModel({
                name: formName,
                fields: {
                    selectedAccount: selectedAccount
                }
            });
            this.isFormInitialized(true);
        }
    }

    onSubmit() {
        this.close();
    }

    onCancel() {
        this.close();
    }

    dispose() {
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: ConnectAppModalViewModel,
    template: template
};
