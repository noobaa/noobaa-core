/* Copyright (C) 2016 NooBaa */

import template from './after-upgrade-modal.html';
import { action$ } from 'state';
import { closeModal, requestLocation } from 'action-creators';

class AfterUpgradeModalViewModel {
    constructor({ version, user, upgradeInitiator, redirectUrl }) {
        const welcomeMessage = (!upgradeInitiator || user === upgradeInitiator) ?
            'Welcome Back!' :
            `${upgradeInitiator} recently updated the system version.`;

        this.version = version;
        this.redirectUrl = redirectUrl;
        this.welcomeMessage = welcomeMessage;
    }

    onDone() {
        action$.onNext(closeModal());
        action$.onNext(requestLocation(this.redirectUrl, true));
    }
}

export default {
    viewModel: AfterUpgradeModalViewModel,
    template: template
};
