/* Copyright (C) 2016 NooBaa */

import template from './finalize-upgrade-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { replaceWithAfterUpgradeModal } from 'action-creators';

class FinalizeUpgradeModalViewModel extends Observer {
    constructor() {
        super();

        this.observe(
            state$.getMany(
                ['location', 'pathname'],
                ['session', 'user'],
                'system'
            ),
            this.onState
        );
    }

    onState([pathname, user, system]) {
        if (!user || !system) return;

        const { lastUpgrade }  = system.upgrade;
        const upgradeInitiator = lastUpgrade && lastUpgrade.initiator;
        const redirectUrl = pathname;

        action$.onNext(replaceWithAfterUpgradeModal(
            system.version,
            user,
            upgradeInitiator,
            redirectUrl
        ));
    }
}

export default {
    viewModel: FinalizeUpgradeModalViewModel,
    template: template
};
