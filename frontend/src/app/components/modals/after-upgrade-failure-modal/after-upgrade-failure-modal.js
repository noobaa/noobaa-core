/* Copyright (C) 2016 NooBaa */

import template from './after-upgrade-failure-modal.html';
import { action$ } from 'state';
import { requestLocation, closeModal } from 'action-creators';
import { formatEmailUri } from 'utils/browser-utils';
import { support } from 'config';

class AfterUpgradeFailureModalViewModel {
    redirectUrl = '';
    supportEmail = formatEmailUri(support.email, support.upgradeFailedSubject);

    constructor({ redirectUrl }) {
        this.redirectUrl = redirectUrl;
    }

    onGoBack() {
        action$.next(closeModal());
        action$.next(requestLocation(this.redirectUrl, true));
    }
}

export default {
    viewModel: AfterUpgradeFailureModalViewModel,
    template: template
};
