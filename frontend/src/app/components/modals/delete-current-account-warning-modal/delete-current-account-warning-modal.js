/* Copyright (C) 2016 NooBaa */

import template from './delete-current-account-warning-modal.html';
import { action$ } from 'state';
import { tryDeleteAccount } from 'action-creators';

class DeleteAccountWarningModalViewModel {
    constructor({ email, onClose }) {
        this.close = onClose;
        this.email = email;
    }

    onDelete() {
        this.close();
        action$.next(tryDeleteAccount(this.email, true, true));
    }

    onCancel() {
        this.close();
    }
}

export default {
    viewModel: DeleteAccountWarningModalViewModel,
    template: template
};
