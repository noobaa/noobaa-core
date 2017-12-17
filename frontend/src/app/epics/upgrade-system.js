/* Copyright (C) 2017 NooBaa */

import Rx from 'rx';
import { flatMap } from 'utils/core-utils';
import { fetchSystemInfo, completeUpgradeSystem, failUpgradeSystem } from 'action-creators';
import {
    COMPLETE_FETCH_SYSTEM_INFO,
    FAIL_FETCH_SYSTEM_INFO,
    UPGRADE_SYSTEM,
    COMPLETE_UPGRADE_SYSTEM,
    FAIL_UPGRADE_SYSTEM
} from 'action-types';

const { fromPromise, interval, merge } = Rx.Observable;

function _upgradeFailure(action) {
    return flatMap(
        action.payload.cluster.shards,
        shard => shard.servers.map(server => server.upgrade.status)
    )
        .some(status => status === 'FAILED' || status === 'UPGRADE_FAILED');
}

export default function(action$, { api, browser }) {
    return action$
        .ofType(UPGRADE_SYSTEM)
        .flatMap(action => {
            const { system } = action.payload;

            const successe$ = action$
                .ofType(FAIL_FETCH_SYSTEM_INFO)
                .takeUntil(action$.ofType(FAIL_UPGRADE_SYSTEM))
                .take(1)
                .flatMap(() => browser.httpWaitForResponse('/version', 200))
                .map(() => completeUpgradeSystem(system));

            const failure$ = action$
                .ofType(COMPLETE_FETCH_SYSTEM_INFO)
                .filter(_upgradeFailure)
                .takeUntil(action$.ofType(COMPLETE_UPGRADE_SYSTEM))
                .take(1)
                .map(() => failUpgradeSystem());

            // Dispatch fetch system info every 30 sec while upgrading.
            const update$ = fromPromise(api.cluster_internal.upgrade_cluster())
                .flatMap(interval(30 * 1000))
                .takeUntil(action$.ofType(FAIL_UPGRADE_SYSTEM, COMPLETE_UPGRADE_SYSTEM))
                .map(() => fetchSystemInfo());

            return merge(update$, successe$, failure$);
        });
}
