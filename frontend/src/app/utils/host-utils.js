/* Copyright (C) 2016 NooBaa */

import { deepFreeze, mapValues, sumBy, isNumber, flatMap } from './core-utils';
import { stringifyAmount } from 'utils/string-utils';
import moment from 'moment';
import numeral from 'numeral';

const modeToStateIcon = deepFreeze({
    DECOMMISSIONED: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Node Deactivated'
    },
    OFFLINE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Offline'
    },
    STORAGE_OFFLINE: {
        name: 'problem',
        css: 'error',
        tooltip: 'All Drives Offline'
    },
    UNTRUSTED: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Has Issues'
    },
    STORAGE_NOT_EXIST: {
        name: 'problem',
        css: 'error',
        tooltip: 'All Drives are Unmounted'
    },
    IO_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'All drives have I/O errors'
    },
    N2N_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'Node to node communication problems'
    },
    GATEWAY_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'Server communication problems'
    },
    INITIALIZING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Initializing'
    },
    DECOMMISSIONING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Deactivating'
    },
    MIGRATING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Migrating'
    },
    IN_PROCESS: {
        name: 'working',
        css: 'warning',
        tooltip: 'In Process'
    },
    SOME_STORAGE_MIGRATING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Some Drives are Migrating'
    },
    SOME_STORAGE_INITIALIZING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Some Drives are Initializing'
    },
    SOME_STORAGE_DECOMMISSIONING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Some Drives are Deactivating'
    },
    DELETING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Deleting Node'
    },
    SOME_STORAGE_OFFLINE: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some Drives are Offline'
    },
    SOME_STORAGE_NOT_EXIST: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some Drives are Unmounted'
    },
    SOME_STORAGE_IO_ERRORS: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some Drives have I/O errors'
    },
    NO_CAPACITY: {
        name: 'problem',
        css: 'warning',
        tooltip: 'No Available Capacity'
    },
    LOW_CAPACITY: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Low Available Capacity'
    },
    HAS_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'Services have Errors'
    },
    HAS_ISSUES: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Services have Issues'
    },
    N2N_PORTS_BLOCKED: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some Ports Might be Blocked'
    },
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

const trustToIcon = deepFreeze({
    true: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Trusted'
    },
    false: {
        name: 'problem',
        css: 'error',
        tooltip: 'Untrusted'
    }
});

const modeToAccessibilityIcon = deepFreeze({
    DECOMMISSIONED: {
        name: 'healthy',
        css: 'success',
        tooltip: 'No Access'
    },
    OFFLINE: {
        name: 'problem',
        css: 'error',
        tooltip: 'No access'
    },
    UNTRUSTED: {
        name: 'problem',
        css: 'error',
        tooltip: 'No access'
    },
    STORAGE_NOT_EXIST: {
        name: 'problem',
        css: 'error',
        tooltip: 'No access'
    },
    IO_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'No access'
    },
    GATEWAY_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'No access'
    },
    N2N_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'No access'
    },
    DELETING: {
        name: 'problem',
        css: 'error',
        tooltip: 'No Access'
    },
    INITIALIZING: {
        name: 'problem',
        css: 'error',
        tooltip: 'No access'
    },
    DECOMMISSIONING: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Read Only'
    },
    MIGRATING: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Read Only - Moving data'
    },
    IN_PROCESS: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    },
    SOME_STORAGE_MIGRATING: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    },
    SOME_STORAGE_INITIALIZING: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    },
    SOME_STORAGE_DECOMMISSIONING: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    },
    SOME_STORAGE_OFFLINE: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    },
    SOME_STORAGE_NOT_EXIST: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    },
    SOME_STORAGE_IO_ERRORS: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    },
    NO_CAPACITY: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Read Only'
    },
    LOW_CAPACITY: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    },
    N2N_PORTS_BLOCKED: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    },
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    }
});

const stateToModes = deepFreeze({
    HEALTHY: [
        'OPTIMAL'
    ],
    HAS_ISSUES: [
        'STORAGE_OFFLINE',
        'DECOMMISSIONED',
        'UNTRUSTED',
        'STORAGE_NOT_EXIST',
        'IO_ERRORS',
        'N2N_ERRORS',
        'GATEWAY_ERRORS',
        'INITIALIZING',
        'DELETING',
        'DECOMMISSIONING',
        'MIGRATING',
        'IN_PROCESS',
        'SOME_STORAGE_MIGRATING',
        'SOME_STORAGE_INITIALIZING',
        'SOME_STORAGE_DECOMMISSIONING',
        'SOME_STORAGE_OFFLINE',
        'SOME_STORAGE_NOT_EXIST',
        'SOME_STORAGE_IO_ERRORS',
        'NO_CAPACITY',
        'LOW_CAPACITY',
        'HAS_ERRORS',
        'HAS_ISSUES',
        'N2N_PORTS_BLOCKED'
    ],
    OFFLINE: [
        'OFFLINE'
    ]
});

const serviceToDisplayName = deepFreeze({
    storage: 'Storage'
});

const storageNodeModeToStateIcon = deepFreeze({
    OFFLINE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Offline'
    },
    UNTRUSTED: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Untrusted'
    },
    INITIALIZING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Initializing'
    },
    DELETING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Deleting'
    },
    DECOMMISSIONING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Deactivating'
    },
    DECOMMISSIONED: {
        name: 'healthy',
        css: '',
        tooltip: 'Deactivated'
    },
    MIGRATING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Migrating'
    },
    N2N_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'Node to node communication problems'
    },
    GATEWAY_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'Server communication problems'
    },
    IO_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'Read/Write problems'
    },
    LOW_CAPACITY: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Available capacity is low'
    },
    NO_CAPACITY: {
        name: 'problem',
        css: 'warning',
        tooltip: 'No available capacity'
    },
    N2N_PORTS_BLOCKED: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some ports might be blocked'
    },
    STORAGE_NOT_EXIST: {
        name: 'problem',
        css:'error',
        tooltip: 'Drive is unmounted'
    },
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

const activityTypeToName = deepFreeze({
    RESTORING: 'Restoring',
    MIGRATING: 'Migrating',
    DECOMMISSIONING: 'Deactivating',
    DELETING: 'Deleting'
});

const activityStageToName = deepFreeze({
    OFFLINE_GRACE: 'Waiting',
    REBUILDING: 'Rebuilding',
    WIPING: 'Wiping Data'
});

const dataActivityTooltipTemplate =
    `<ul class="list-no-style column" ko.foreach="$data">
        <li class="push-next-half">
            <p ko.text="activity"><p>
            <p class="remark push-next-half" ko.text="eta"></p>
        </li>
    </ul>`;

export const hostWritableModes = deepFreeze([
    'IN_PROCESS',
    'SOME_STORAGE_MIGRATING',
    'SOME_STORAGE_INITIALIZING',
    'SOME_STORAGE_DECOMMISSIONING',
    'SOME_STORAGE_OFFLINE',
    'SOME_STORAGE_NOT_EXIST',
    'SOME_STORAGE_IO_ERRORS',
    'LOW_CAPACITY',
    'N2N_PORTS_BLOCKED',
    'OPTIMAL'
]);

export const storageNodeWritableModes = deepFreeze([
    'OPTIMAL',
    'LOW_CAPACITY',
    'N2N_PORTS_BLOCKED'
]);

export function getHostDisplayName(hostName) {
    const [ namePart ] = hostName.split('#');
    return `${namePart}`;
}

export function getHostStateIcon(host) {
    return modeToStateIcon[host.mode];
}

export function getHostTrustIcon(host) {
    return trustToIcon[host.trusted];
}

export function getHostAccessibilityIcon(host) {
    return modeToAccessibilityIcon[host.services.storage.mode];
}

export function getNodeOrHostCapacityBarValues({ storage }) {
    const { total, used, usedOther} = storage;
    const usage = [
        { value: used, label: 'Used (Noobaa)' },
        { value: usedOther, label: 'Used (other)' }
    ];
    return { total, used: usage };
}

export function getHostModeListForState(state) {
    return stateToModes[state];
}

export function getHostModeListForStates(...states) {
    return flatMap(states, state => stateToModes[state]);
}

export function summrizeHostModeCounters(counters) {
    const { HEALTHY, HAS_ISSUES, OFFLINE } = mapValues(
        stateToModes,
        modes => sumBy(modes, mode => counters[mode] || 0)
    );

    return {
        all: HEALTHY + HAS_ISSUES + OFFLINE,
        healthy: HEALTHY,
        hasIssues: HAS_ISSUES,
        offline: OFFLINE
    };
}

export function getHostServiceDisplayName(service) {
    return serviceToDisplayName[service];
}

export function getStorageNodeStateIcon(host) {
    return storageNodeModeToStateIcon[host.mode];
}

export function getActivityName(activityType) {
    return activityTypeToName[activityType];
}

export function getActivityStageName(stage) {
    return activityStageToName[stage];
}

export function getActivityListTooltip(activityList) {
    const data = activityList.map(act => {
        const name = activityTypeToName[act.kind];
        const driveCount = stringifyAmount('drive', act.nodeCount);
        const progress = numeral(act.progress).format('%');
        const eta = isNumber(act.eta) ? moment(act.eta).fromNow() : 'calculating...';

        return {
            activity: `${name} ${driveCount} ${progress}`,
            eta: `ETA: ${eta}`
        };
    });

    return {
        template: dataActivityTooltipTemplate,
        text: data.length ? data : null
    };
}
