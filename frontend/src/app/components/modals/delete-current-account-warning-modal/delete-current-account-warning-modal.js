/* Copyright (C) 2016 NooBaa */

import template from './delete-current-account-warning-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal, tryDeleteAccount } from 'action-creators';
import ko from 'knockout';

class DeleteAccountWarningModalViewModel extends ConnectableViewModel {
    email = ko.observable();

    selectState(state, params) {
        return [
            params.email
        ];
    }

    mapStateToProps(email) {
        ko.assignToProps(this, {
            email
        });
    }

    onDelete() {
        this.dispatch(
            closeModal(),
            tryDeleteAccount(this.email(), true, true)
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: DeleteAccountWarningModalViewModel,
    template: template
};
