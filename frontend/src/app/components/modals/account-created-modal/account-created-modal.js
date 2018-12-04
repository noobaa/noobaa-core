/* Copyright (C) 2016 NooBaa */

import template from './account-created-modal.html';
import accountDetailsMessageTempalte from './account-details-message.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { closeModal } from 'action-creators';

class AccountCreatedModalViewModel extends ConnectableViewModel {
    serverAddress = ko.observable();
    message = ko.observable();

    selectState(state, params) {
        const { accounts, location, system } = state;
        return [
            accounts[params.accountName],
            params.password,
            location.hostname,
            system.sslPort
        ];
    }

    mapStateToProps(account, password, endpoint, sslPort) {
        const { name, hasLoginAccess, hasS3Access, accessKeys } = account;
        const message = ko.renderToString(
            accountDetailsMessageTempalte,
            {
                serverAddress: `https://${endpoint}:${sslPort}`,
                username: hasLoginAccess ? name : '',
                password: hasLoginAccess ? password : '',
                accessKey: hasS3Access ? accessKeys.accessKey : '',
                secretKey: hasS3Access ? accessKeys.secretKey : ''
            }
        );

        ko.assignToProps(this, { message });
    }

    onDone() {
        this.dispatch(closeModal());
    }

}

export default {
    viewModel: AccountCreatedModalViewModel,
    template: template
};
