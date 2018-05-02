import Rx from 'rx';
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


const {  just, interval, merge } = Rx.Observable;

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
    return action$
        .ofType(COMPLETE_FETCH_SYSTEM_INFO)
        .distinctUntilChanged(_isSystemUpgrading)
        .filter(_isSystemUpgrading)
        .flatMap(action => {
            const { name: systemName, cluster } = action.payload;
            const expectedVersion = cluster.shards[0].servers[0].upgrade.staged_package;

            const successe$ = action$
                .ofType(FAIL_FETCH_SYSTEM_INFO)
                .takeUntil(action$.ofType(FAIL_UPGRADE_SYSTEM))
                .take(1)
                .flatMap(() => browser.httpWaitForResponse('/version', 200))
                .map(() => completeUpgradeSystem(systemName, expectedVersion));

            const failure$ = action$
                .ofType(COMPLETE_FETCH_SYSTEM_INFO)
                .filter(_hasUpgradeFailed)
                .takeUntil(action$.ofType(COMPLETE_UPGRADE_SYSTEM))
                .take(1)
                .map(() => failUpgradeSystem(systemName));

            // Dispatch a fetch system info every 10 sec while upgrading to pull upgrade status and progress.
            const fetches$ = interval(10 * 1000)
                .takeUntil(action$.ofType(FAIL_FETCH_SYSTEM_INFO, FAIL_UPGRADE_SYSTEM))
                .map(() => fetchSystemInfo());

            return just(upgradeSystem(systemName))
                .concat(merge([fetches$, successe$, failure$]));
        });
}
