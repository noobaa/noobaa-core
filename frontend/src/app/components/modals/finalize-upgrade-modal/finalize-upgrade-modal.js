/* Copyright (C) 2016 NooBaa */

import template from './finalize-upgrade-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { getMany } from 'rx-extensions';
import {
    replaceWithAfterUpgradeModal,
    replaceWithAfterUpgradeFailureModal
} from 'action-creators';

class FinalizeUpgradeModalViewModel extends Observer {
    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'location',
                    ['session', 'user'],
                    'system'
                )
            ),
            this.onState
        );
    }

    onState([location, user, system]) {
        if (!user || !system) return;

        const { pathname, query } = location;
        const { lastUpgrade }  = system.upgrade;
        const upgradeInitiator = lastUpgrade && lastUpgrade.initiator;
        const redirectUrl = pathname;
        const expectedVersion = query.afterupgrade;

        if (expectedVersion === true || expectedVersion === system.version) {
            action$.next(replaceWithAfterUpgradeModal(
                system.version,
                user,
                upgradeInitiator,
                redirectUrl
            ));
        } else {
            action$.next(replaceWithAfterUpgradeFailureModal(
                redirectUrl
            ));
        }
    }
}

export default {
    viewModel: FinalizeUpgradeModalViewModel,
    template: template
};
