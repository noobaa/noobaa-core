/* Copyright (C) 2016 NooBaa */

import template from './account-created-modal.html';
import accountDetailsMessageTemplate from './account-details-message.html';
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
        const { name, isAdmin, accessKeys } = account;
        const message = ko.renderToString(
            accountDetailsMessageTemplate,
            {
                serverAddress: `https://${endpoint}:${sslPort}`,
                username: isAdmin ? name : '',
                password: isAdmin ? password : '',
                accessKey: accessKeys.accessKey,
                secretKey: accessKeys.secretKey
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
