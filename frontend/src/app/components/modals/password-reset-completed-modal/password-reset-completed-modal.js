/* Copyright (C) 2016 NooBaa */

import template from './password-reset-completed-modal.html';
import userMessageTemplate from './user-message.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { closeModal } from 'action-creators';

class PasswordResetSuccessfulModalViewModel extends ConnectableViewModel {
    accountName = ko.observable();
    userMessage = ko.observable();

    selectState(state, params) {
        return [
            params.accountName,
            params.password
        ];
    }

    mapStateToProps(accountName, password) {
        const userMessage = ko.renderToString(
            userMessageTemplate,
            { accountName, password }
        );

        ko.assignToProps(this, {
            accountName,
            userMessage
        });
    }

    onDone() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: PasswordResetSuccessfulModalViewModel,
    template: template
};
