/* Copyright (C) 2016 NooBaa */

import template from './password-reset-failed-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { formatEmailUri } from 'utils/browser-utils';
import { closeModal } from 'action-creators';
import { support } from 'config';

class PasswordResetFailedModalViewModel extends ConnectableViewModel {
    accountName = ko.observable();
    supportHref = formatEmailUri(support.email, support.cannotResetAccountPasswordSubject);

    selectState(state, params) {
        return [
            params.accountName
        ];
    }

    mapStateToProps(accountName) {
        ko.assignToProps(this, {
            accountName
        });
    }

    onClose() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: PasswordResetFailedModalViewModel,
    template: template
};
