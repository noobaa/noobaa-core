/* Copyright (C) 2016 NooBaa */

import template from './upgrade-system-failed-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal } from 'action-creators';
import { formatEmailUri } from 'utils/browser-utils';
import { support } from 'config';

class UpgradeSystemFailedModalViewModel extends ConnectableViewModel {
    supportEmail = formatEmailUri(
        support.email,
        support.upgradeFailedSubject
    );

    onGoBack() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: UpgradeSystemFailedModalViewModel,
    template: template
};
