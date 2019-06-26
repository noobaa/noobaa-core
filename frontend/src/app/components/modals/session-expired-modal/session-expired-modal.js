/* Copyright (C) 2016 NooBaa */

import template from './session-expired-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal, signOut } from 'action-creators';

class sessionExpiredModal extends ConnectableViewModel {
    onBackToLogin() {
        this.dispatch(
            closeModal(),
            signOut()
        );
    }

}

export default {
    viewModel: sessionExpiredModal,
    template: template
};
