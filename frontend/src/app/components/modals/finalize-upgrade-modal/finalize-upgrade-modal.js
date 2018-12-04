/* Copyright (C) 2016 NooBaa */

import template from './finalize-upgrade-modal.html';
import ConnectableViewModel from 'components/connectable';
import {
    closeModal,
    openAfterUpgradeModal,
    openAfterUpgradeFailureModal
} from 'action-creators';

class FinalizeUpgradeModalViewModel extends ConnectableViewModel {
    selectState(state) {
        const { location, session = {}, system = {} } = state;
        return [
            session.user,
            system.version,
            location.query.afterupgrade,
            system.upgrade && system.upgrade.lastUpgrade,
            location.pathname
        ];
    }

    mapStateToProps(user, version, expectedVersion, lastUpgrade, redirectUrl) {
        if (!user || !version) return;

        if (expectedVersion === true || expectedVersion === version) {
            this.dispatch(
                closeModal(),
                openAfterUpgradeModal(
                    version,
                    user,
                    lastUpgrade && lastUpgrade.initiator,
                    redirectUrl
                )
            );

        } else {
            this.dispatch(
                closeModal(),
                openAfterUpgradeFailureModal(redirectUrl)
            );
        }
    }
}

export default {
    viewModel: FinalizeUpgradeModalViewModel,
    template: template
};
