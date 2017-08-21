import { deepFreeze, mapValues, sumBy, isNumber } from './core-utils';
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
        tooltip: 'All Services Offline'
    },
    S3_OFFLINE: {
        name: 'problem',
        css: 'error',
        tooltip: 'S3 Gateway Offline'
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
    DETENTION: {
        name: 'problem',
        css: 'error',
        tooltip: 'All Drives has No Access'
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
        tooltip: 'Some drives are Initializing'
    },
    SOME_STORAGE_DECOMMISSIONING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Some drives are Decommissioning'
    },
    SOME_STORAGE_OFFLINE: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some drives are Offline'
    },
    SOME_STORAGE_NOT_EXIST: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some drives are Unmounted'
    },
    SOME_STORAGE_DETENTION: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some drives has No Access'
    },
    NO_CAPACITY: {
        name: 'problem',
        css: 'warning',
        tooltip: 'No available capacity'
    },
    LOW_CAPACITY: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Low available capacity'
    },
    HTTP_SRV_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'Cannot Start HTTP Server'
    },
    HAS_ERRORS: {
        name: 'problem',
        css: 'error',
        tooltip: 'Services has Errors'
    },
    HAS_ISSUES: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Services has Issues'
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
        tooltip: 'Untrusted',
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
    DETENTION: {
        name: 'problem',
        css: 'error',
        tooltip: 'No access - Read/Write errors'
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
    SOME_STORAGE_DETENTION: {
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
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Readable & Writable'
    },
});

const stateToModes = deepFreeze({
    HEALTHY: [
        'OPTIMAL'
    ],
    HAS_ISSUES: [
        'DECOMMISSIONED',
        'UNTRUSTED',
        'STORAGE_NOT_EXIST',
        'DETENTION',
        'INITIALIZING',
        'DECOMMISSIONING',
        'MIGRATING',
        'IN_PROCESS',
        'SOME_STORAGE_MIGRATING',
        'SOME_STORAGE_INITIALIZING',
        'SOME_STORAGE_DECOMMISSIONING',
        'SOME_STORAGE_OFFLINE',
        'SOME_STORAGE_NOT_EXIST',
        'SOME_STORAGE_DETENTION',
        'NO_CAPACITY',
        'LOW_CAPACITY',
        'HTTP_SRV_ERRORS',
        'HAS_ERRORS',
        'HAS_ISSUES'
    ],
    OFFLINE: [
        'OFFLINE'
    ]
});

const storageServiceModeToIcon = deepFreeze({
    DECOMMISSIONED: {
        name: 'healthy',
        css: '',
        tooltip: 'Disabled'
    },
    OFFLINE: {
        name: 'problem',
        css: 'error',
        tooltip: 'All drives are offline'
    },
    UNTRUSTED: {
        name: 'problem',
        css: 'error',
        tooltip: 'Untrusted'
    },
    STORAGE_NOT_EXIST: {
        name: 'problem',
        css: 'error',
        tooltip: 'All drives are unmounted'
    },
    DETENTION: {
        name: 'problem',
        css: 'error',
        tooltip: 'All drive has no access'
    },
    INITIALIZING: {
        name: 'working',
        css: 'warning',
        tooltip: 'All drive has no access'
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
        tooltip: 'In process'
    },
    SOME_STORAGE_MIGRATING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Some drives are migrating'
    },
    SOME_STORAGE_INITIALIZING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Some drives are initializing'
    },
    SOME_STORAGE_DECOMMISSIONING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Some drives are deactivating'
    },
    SOME_STORAGE_OFFLINE: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some drives are offline'
    },
    SOME_STORAGE_NOT_EXIST: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some drives are unmounted'
    },
    SOME_STORAGE_DETENTION: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Some drives has no access'
    },
    NO_CAPACITY: {
        name: 'problem',
        css: 'warning',
        tooltip: 'No available capacity'
    },
    LOW_CAPACITY: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Low available capacity'
    },
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
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
    DELETED: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Deleted'
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
        css: 'warning',
        tooltip: 'Inter-Node connectivity problems'
    },
    GATEWAY_ERRORS: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Server connectivity problems'
    },
    IO_ERRORS: {
        name: 'problem',
        css: 'warning',
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
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

const gatewayServiceModeToIcon = deepFreeze({
    OFFLINE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Offline'
    },
    DECOMMISSIONED: {
        name: 'healthy',
        css: '',
        tooltip: 'Disabled'
    },
    HTTP_SRV_ERRORS: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Cannot start HTTP server'
    },
    INITIALIZING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Initializing'
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

export function getHostDisplayName(hostName) {
    const [ namePart ] = hostName.split('#');
    return `${namePart}`;
}

export function getHostStateIcon({ mode }) {
    return modeToStateIcon[mode];
}

export function getHostTrustIcon({ trusted }) {
    return trustToIcon[trusted];
}

export function getHostAccessibilityIcon({ mode }) {
    return modeToAccessibilityIcon[mode];
}

export function getNodeOrHostCapacityBarValues({ storage }) {
    const { total, used, used_other, reserved } = storage;
    const usage = [
        { value: used, label: 'Used (Noobaa)' },
        { value: used_other, label: 'Used (other)' },
        { value: reserved, label: 'Reserved' }
    ];
    return { total, used: usage };
}

export function getHostModeListForState(state) {
    return stateToModes[state];
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

export function getStorageServiceStateIcon(host) {
    const { mode } = host.services.storage;
    return storageServiceModeToIcon[mode];
}

export function getStorageNodeStateIcon(host) {
    return storageNodeModeToStateIcon[host.mode];
}

export function getGatewayServiceStateIcon(host) {
    const { mode } = host.services.gateway;
    return gatewayServiceModeToIcon[mode];
}

export function getActivityName(activityType) {
    return activityTypeToName[activityType];
}

export function getActivityStageName(stage) {
    return activityStageToName[stage];
}

export function formatActivityListTooltipHtml(activityList) {
    return activityList.map(act => {
        const name = activityTypeToName[act.type];
        const driveCount = stringifyAmount('drive', act.nodeCount);
        const progress = numeral(act.progress).format('%');
        const eta = isNumber(act.eta) ? moment(act.eta).fromNow() : 'calculating...';

        return `
            <p>${name} ${driveCount} ${progress}</p>
            <p class="remark push-next-half">ETA: ${eta}</p>
        `;
    });
}
