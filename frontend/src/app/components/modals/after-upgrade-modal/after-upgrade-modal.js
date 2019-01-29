/* Copyright (C) 2016 NooBaa */

import template from './after-upgrade-modal.html';
import ConnectableViewModel from 'components/connectable';
import { closeModal, requestLocation } from 'action-creators';
import ko from 'knockout';

class AfterUpgradeModalViewModel extends ConnectableViewModel {
    version = ko.observable();
    redirectUrl = '';
    welcomeMessage = ko.observable();

    selectState(_, params) {
        return [
            params.version,
            params.user,
            params.upgradeInitiator,
            params.redirectUrl
        ];
    }

    mapStateToProps(version, user, upgradeInitiator, redirectUrl) {
        const welcomeMessage = (!upgradeInitiator || user === upgradeInitiator) ?
            'Welcome Back!' :
            `${upgradeInitiator} recently updated the system version.`;

        ko.assignToProps(this, {
            version,
            redirectUrl,
            welcomeMessage
        });
    }

    onDone() {
        this.dispatch(
            closeModal(),
            requestLocation(this.redirectUrl, true)
        );
    }
}

export default {
    viewModel: AfterUpgradeModalViewModel,
    template: template
};
