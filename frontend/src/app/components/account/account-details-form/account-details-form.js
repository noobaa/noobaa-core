/* Copyright (C) 2016 NooBaa */

import template from './account-details-form.html';
import { deepFreeze } from 'utils/core-utils';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import {
    openChangePasswordModal,
    openResetPasswordModal
} from 'action-creators';

const actionUnavailableTooltip = deepFreeze({
    align: 'end',
    text: 'This action is unavailable for accounts without login access'
});

class AccountDetailsFormViewModel extends ConnectableViewModel {
    accountName = ko.observable();
    isCurrentUser = false;
    button = {
        label: ko.observable(),
        tooltip: ko.observable(),
        isVisible: ko.observable(),
        isDisabled: ko.observable()
    };
    profileInfo = [
        {
            label: 'Account Name',
            value: ko.observable()
        },
        {
            label: 'Role',
            value: ko.observable()
        }
    ];

    selectState(state, params) {
        const { accounts, session } = state;

        return [
            accounts && accounts[params.accountName],
            session
        ];
    }

    mapStateToProps(account, session) {
        if (!account || !session) {
            ko.assignToProps(this, {
                button: {
                    label: 'Reset Password',
                    isDisabled: true,
                    tooltip: ''
                }
            });

        } else {
            const { user, authorizedBy } = session;
            const { isOwner, hasLoginAccess } = account;
            const isCurrentUser = user === account.name;
            const allowResetPassword = authorizedBy === 'noobaa';
            const role  = !isOwner ?
                (account.hasLoginAccess ? 'Admin' : 'Application') :
                'Owner';

            ko.assignToProps(this, {
                accountName: account.name,
                isCurrentUser,
                button: {
                    label: isCurrentUser ? 'Change Password' : 'Reset Password',
                    isVisible: allowResetPassword,
                    isDisabled: !hasLoginAccess,
                    tooltip: hasLoginAccess ? actionUnavailableTooltip : ''
                },
                profileInfo: [
                    { value: account.name },
                    { value: role }
                ]
            });
        }
    }

    onChangeOrResetPassword() {
        const action = this.isCurrentUser ?
            openChangePasswordModal(this.accountName()) :
            openResetPasswordModal(this.accountName());

        this.dispatch(action);
    }
}

export default {
    viewModel: AccountDetailsFormViewModel,
    template: template
};
