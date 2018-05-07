/* Copyright (C) 2016 NooBaa */

import { ofType } from 'rx-extensions';
import { of, interval, concat, merge } from 'rxjs';
import { takeUntil, map, filter, take,
    distinctUntilChanged, mergeMap } from 'rxjs/operators';
import { flatMap } from 'utils/core-utils';
import {
    upgradeSystem,
    completeUpgradeSystem,
    failUpgradeSystem,
    fetchSystemInfo
} from 'action-creators';
import {
    COMPLETE_FETCH_SYSTEM_INFO,
    FAIL_FETCH_SYSTEM_INFO,
    COMPLETE_UPGRADE_SYSTEM,
    FAIL_UPGRADE_SYSTEM
} from 'action-types';

function _checkForUpgradeStatus(sysInfo, statusList) {
    return flatMap(
        sysInfo.cluster.shards,
        shard => shard.servers.map(server => server.upgrade.status)
    ).some(status => statusList.includes(status));
}

function _isSystemUpgrading(action) {
    return _checkForUpgradeStatus(
        action.payload,
        ['PRE_UPGRADE_PENDING', 'PRE_UPGRADE_READY', 'UPGRADING']
    );
}

function _hasUpgradeFailed(action) {
    return _checkForUpgradeStatus(
        action.payload,
        ['FAILED', 'UPGRADE_FAILED']
    );
}

export default function(action$, { browser }) {
    return action$.pipe(
        ofType(COMPLETE_FETCH_SYSTEM_INFO),
        distinctUntilChanged(Object.is, _isSystemUpgrading),
        filter(_isSystemUpgrading),
        mergeMap(action => {
            const { name: systemName, cluster } = action.payload;
            const expectedVersion = cluster.shards[0].servers[0].upgrade.staged_package;

            const successe$ = action$.pipe(
                ofType(FAIL_FETCH_SYSTEM_INFO),
                takeUntil(action$.pipe(ofType(FAIL_UPGRADE_SYSTEM))),
                take(1),
                mergeMap(() => browser.httpWaitForResponse('/version', 200)),
                map(() => completeUpgradeSystem(systemName, expectedVersion))
            );

            const failure$ = action$.pipe(
                ofType(COMPLETE_FETCH_SYSTEM_INFO),
                filter(_hasUpgradeFailed),
                takeUntil(action$.pipe(ofType(COMPLETE_UPGRADE_SYSTEM))),
                take(1),
                map(() => failUpgradeSystem(systemName))
            );

            // Dispatch a fetch system info every 10 sec while upgrading to pull upgrade status and progress.
            const fetches$ = interval(10 * 1000).pipe(
                takeUntil(action$.pipe(ofType(FAIL_FETCH_SYSTEM_INFO, FAIL_UPGRADE_SYSTEM))),
                map(() => fetchSystemInfo())
            );

            return concat(
                of(upgradeSystem(systemName)),
                merge(fetches$, successe$, failure$)
            );
        })
    );
}
