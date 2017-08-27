import { deepFreeze, isFunction } from 'utils/core-utils';
import { toBytes, formatSize } from 'utils/size-utils';
import numeral from 'numeral';

const GB = Math.pow(1024, 3);

const hostsPoolModeToStateIcon = deepFreeze({
    HAS_NO_NODES: {
        tooltip: 'Pool is empty',
        css: 'error',
        name: 'problem'
    },
    NOT_ENOUGH_NODES: {
        tooltip: 'Not enough nodes in pool',
        css: 'error',
        name: 'problem'
    },
    ALL_NODES_OFFLINE: {
        tooltip: 'All nodes are offline',
        css: 'error',
        name: 'problem'
    },
    NOT_ENOUGH_HEALTHY_NODES: {
        tooltip: 'Not enough healthy nodes',
        css: 'error',
        name: 'problem'
    },
    MANY_NODES_OFFLINE: pool => {
        const { hostCount, hostsByMode } = pool;
        const percentage = numeral((hostsByMode.OFFLINE || 0) / hostCount).format('%');

        return {
            tooltip: `${percentage} nodes are offline`,
            css: 'warning',
            name: 'problem'
        };
    },
    NO_CAPACITY: {
        tooltip: 'No available pool capacity',
        css: 'error',
        name: 'problem'
    },
    LOW_CAPACITY: pool => {
        const free = toBytes(pool.storage.free);
        const limit = formatSize(Math.max(30 * GB, .2 * free));

        return {
            tooltip: `Available capacity is below ${limit}`,
            css: 'warning',
            name: 'problem'
        };
    },
    HIGH_DATA_ACTIVITY: {
        tooltip: 'High data activity in pool',
        css: 'warning',
        name: 'working'
    },
    OPTIMAL: {
        tooltip: 'Healthy',
        css: 'success',
        name: 'healthy'
    }
});

export function getHostsPoolStateIcon(pool) {
    const { mode } = pool;
    const state = hostsPoolModeToStateIcon[mode];
    return isFunction(state) ? state(pool) : state;
}
