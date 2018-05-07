/* Copyright (C) 2016 NooBaa */

import template from './account-created-modal.html';
import accountDetailsMessageTempalte from './account-details-message.html';
import Observer from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import { get } from 'rx-extensions';

// TODO: Replace with data from the state$ when available.
import { systemInfo } from 'model';

class AccountCreatedModalViewModel extends Observer {
    constructor({ onClose, accountName, password }) {
        super();

        this.onClose = onClose;
        this.serverAddress = ko.observable();
        this.password = password;
        this.message = ko.observable();

        this.observe(
            state$.pipe(get('accounts', accountName)),
            this.onAccount
        );
    }

    onAccount(account) {
        const { endpoint, ssl_port } = systemInfo();
        const { name, hasLoginAccess, hasS3Access, accessKeys } = account;

        const data = {
            serverAddress: `https://${endpoint}:${ssl_port}`,
            username: hasLoginAccess ? name : '',
            password: hasLoginAccess ? this.password : '',
            accessKey: hasS3Access ? accessKeys.accessKey : '',
            secretKey: hasS3Access ? accessKeys.secretKey : ''
        };

        this.message(
            ko.renderToString(accountDetailsMessageTempalte, data)
        );
    }


}

export default {
    viewModel: AccountCreatedModalViewModel,
    template: template
};
