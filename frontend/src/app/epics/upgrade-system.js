/* Copyright (C) 2017 NooBaa */

import {
    COMPLETE_FETCH_SYSTEM_INFO,
    FAIL_FETCH_SYSTEM_INFO,
    UPGRADE_SYSTEM
} from 'action-types';


function _upgradeFailed(action) {
    return action.payload.cluster.shards
        .some(shard => shard.servers
            .some(server => server.upgrade.status === 'UPGRADE_FAILED')
        );
}

export default function(action$, { api, browser }) {
    return action$
        .ofType(UPGRADE_SYSTEM)
        .flatMap(() => {
            const upgradeFailure$ = action$
                .ofType(COMPLETE_FETCH_SYSTEM_INFO)
                .filter(_upgradeFailed);

            action$
                .ofType(FAIL_FETCH_SYSTEM_INFO)
                .takeUntil(upgradeFailure$)
                .flatMap(() => browser.httpWaitForResponse('/version', 200))
                .subscribe(() => browser.reload());

            return api.cluster_internal.upgrade_cluster();
        });
}
