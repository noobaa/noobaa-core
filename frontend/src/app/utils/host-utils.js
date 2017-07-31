import { deepFreeze, mapValues, sumBy } from './core-utils';

const modeToIcon = deepFreeze({
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
    // TODO: remove after gap resoultion if not nececeray.
    UNTRUSTED: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Untrusted'
    },
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

const stateToModes = deepFreeze({
    HEALTHY: [
        'OPTIMAL'
    ],
    HAS_ISSUES: [
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

export function getHostStateIcon({ mode }) {
    return modeToIcon[mode];
}

export function getHostCapacityBarValues({ storage }) {
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

