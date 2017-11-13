/* Copyright (C) 2016 NooBaa */

import template from './account-details-form.html';
import { state$ } from 'state';
import Observer from 'observer';
import ko from 'knockout';

class AccountDetailsFormViewModel extends Observer {
    constructor({ accountName }) {
        super();

        this.accountName = ko.observable();
        this.role = ko.observable();
        this.isCurrentUser = ko.observable();
        this.changePasswordButtonLabel = ko.observable();
        this.disableChangePasswordButton = ko.observable();
        this.changePasswordButtonTooltip = ko.observable();

        this.profileInfo = [
            {
                label: 'Account name',
                value: this.accountName
            },
            {
                label: 'Role',
                value: this.role
            }
        ];

        this.observe(
            state$.getMany(
                ['accounts', ko.unwrap(accountName)],
                ['session', 'user']
            ),
            this.onAccount
        );

        // TODO: Move the modals into Modal Maneger
        this.isPasswordModalVisible = ko.observable(false);
    }

    onAccount([ account, currentUser ]) {
        if (!account) return;

        const { isOwner } = account;
        const isCurrentUser = currentUser === account.name;
        const role  = !isOwner ?
            (account.hasLoginAccess ? 'Admin' : 'Application') :
            'Owner';

        this.accountName(account.name);
        this.role(role);
        this.isCurrentUser(isCurrentUser);
        this.changePasswordButtonLabel(isCurrentUser ? 'Change Password' : 'Reset Password');
        this.disableChangePasswordButton(!account.hasLoginAccess);
        this.changePasswordButtonTooltip(!account.hasLoginAccess ?
            'This action is unavailable for accounts without login access' :
            ''
        );
    }

    showPasswordModal() {
        this.isPasswordModalVisible(true);
    }

    hidePasswordModal() {
        this.isPasswordModalVisible(false);
    }
}

export default {
    viewModel: AccountDetailsFormViewModel,
    template: template
};
