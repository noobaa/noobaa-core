import { deepFreeze, mapValues, sumBy } from './core-utils';

const modeToStateIcon = deepFreeze({
    OFFLINE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Offline'
    },
    DECOMMISSIONED: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Deactivated'
    },
    'UNTRUSTED': {
        name: 'problem',
        css: 'warning',
        tooltip: 'Node has issues'
    },
    HAS_ISSUES: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Node has issues'
    },
    MEMORY_PRESSURE: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Node experiencing memory pressure'
    },
    DECOMMISSIONING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Deactivating'
    },
    DATA_ACTIVITY: {
        name: 'working',
        css: 'warning',
        tooltip: 'In Process'
    },
    INITALIZING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Initalizing'
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
    /// ???
});

const stateToModes = deepFreeze({
    HEALTHY: [
        'OPTIMAL'
    ],
    HAS_ISSUES: [
        'UNTRUSTED',
        'DECOMMISSIONED',
        'DECOMMISSIONING',
        'DATA_ACTIVITY',
        'HAS_ISSUES',
        'MEMORY_PRESSURE',
        'INITALIZING'
    ],
    OFFLINE: [
        'OFFLINE'
    ]
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

const stroageServiceModeToState = deepFreeze({
    OFFLINE: 'problem',
    DECOMMISSIONED: 'disabled',
    DECOMMISSIONING: 'issues',
    UNTRUSTED: 'issues',
    DETENTION: 'issues',
    HAS_ISSUES: 'issues',
    NO_CAPACITY: 'issues',
    DATA_ACTIVITY: 'issues',
    LOW_CAPACITY: 'issues',
    INITALIZING: 'issues',
    MEMORY_PRESSURE: 'issues',
    OPTIMAL: 'healthy'
});

const gatewayServiceModeToState = deepFreeze({
    OFFLINE: 'problem',
    DECOMMISSIONED: 'disabled',
    HTTP_SRV_ERRORS: 'issues',
    INITALIZING: 'issues',
    OPTIMAL: 'healthy'
});

const gatewayServiceModeToIcon = deepFreeze({
    OFFLINE: {
        name: 'problem',
        css: 'error',
        tooltip: 'Offline'
    },
    DECOMMISSIONED: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Deactivated'
    },
    HTTP_SRV_ERRORS: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Cannot start HTTP server'
    },
    INITALIZING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Initalizing'
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
    INITALIZING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Initalizing'
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
        name: 'problem',
        css: 'warning',
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

export function getHostServiceState({ services }) {
    const { storage, gateway } = services;

    return {
        storage: stroageServiceModeToState[storage.mode],
        gateway: gatewayServiceModeToState[gateway.mode],
    };
}

export function getStorageNodeStateIcon({ mode }) {
    return storageNodeModeToStateIcon[mode];
}

export function getGatewayServiceStateIcon({ mode }) {
    return gatewayServiceModeToIcon[mode];
}

export function getNodeActivityName(activityType) {
    return activityTypeToName[activityType];
}

export function getNodeActivityStageName(stage) {
    return activityStageToName[stage];
}
