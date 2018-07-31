/* Copyright (C) 2016 NooBaa */

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
    ALL_NODES_OFFLINE: {
        tooltip: 'All nodes are offline',
        css: 'error',
        name: 'problem'
    },
    NO_CAPACITY: {
        tooltip: 'No available pool capacity',
        css: 'error',
        name: 'problem'
    },
    ALL_HOSTS_IN_PROCESS: {
        tooltip: 'All Nodes are migrating/deactivating/initializing ',
        css: 'warning',
        name: 'working'
    },
    MOST_NODES_ISSUES: {
        tooltip: 'More than 90% of drives and endpoints have issues',
        css: 'error',
        name: 'problem'
    },
    MANY_NODES_ISSUES: {
        tooltip: 'More than 50% of drives and endpoints have issues',
        css: 'warning',
        name: 'problem'
    },
    MOST_STORAGE_ISSUES: {
        tooltip: 'More than 90% of storage drives have issues',
        css: 'error',
        name: 'problem'
    },
    MANY_STORAGE_ISSUES: {
        tooltip: 'More than 50% of storage drives have issues',
        css: 'warning',
        name: 'problem'
    },
    MOST_S3_ISSUES: {
        tooltip: 'More than 90% of S3 endpoints have issues',
        css: 'error',
        name: 'problem'
    },
    MANY_S3_ISSUES: {
        tooltip: 'More than 50% of S3 endpoints have issues',
        css: 'warning',
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

const cloudResourceModeToStateIcon = deepFreeze({
    OPTIMAL: {
        tooltip: 'Healthy',
        css: 'success',
        name: 'healthy'
    },
    IO_ERRORS: {
        tooltip: 'Resource has Read/Write problems',
        css: 'error',
        name: 'problem'
    },
    STORAGE_NOT_EXIST: resource => {
        const tooltip = resource.type === 'AZURE' ?
            'Target Azure container does not exist' :
            'Target S3 bucket does not exist';

        return {
            tooltip,
            css: 'error',
            name: 'problem'
        };
    },
    AUTH_FAILED: {
        tooltip: 'Authentication failure',
        css: 'error',
        name: 'problem'
    },
    INITIALIZING: {
        tooltip: 'Initializing',
        css: 'warning',
        name: 'working'
    },
    ALL_NODES_OFFLINE: {
        tooltip: 'Offline',
        css: 'error',
        name: 'problem'
    }
});

const internalResourceModeToStateIcon = deepFreeze({
    INITIALIZING: {
        tooltip: 'Initializing',
        css: 'warning',
        name: 'working'
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
    ALL_NODES_OFFLINE: {
        tooltip: 'Resource is offline',
        css: 'error',
        name: 'problem'
    },
    NO_CAPACITY: {
        tooltip: 'No available resource capacity',
        css: 'error',
        name: 'problem'
    },
    IO_ERRORS: {
        tooltip: 'Resource has Read/Write problems',
        css: 'error',
        name: 'problem'
    },
    OPTIMAL: {
        tooltip: 'Healthy',
        css: 'success',
        name: 'healthy'
    }
});

const namespaceResourceModeToStateIcon = deepFreeze({
    OPTIMAL: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

const cloudAndNamespaceResourceTypeToIcon = deepFreeze({
    AWS: {
        name: 'aws-s3',
        tooltip: 'AWS S3 resource'
    },
    AZURE: {
        name: 'azure',
        tooltip: 'Azure blob resource'
    },
    GOOGLE: {
        name: 'google-cloud',
        tooltip: 'Google Cloud resource'
    },
    S3_COMPATIBLE: {
        name: 'cloud',
        tooltip: 'Generic S3 compatible resource'
    },
    NET_STORAGE: {
        name: 'net-storage',
        tooltip: 'NetStorage resource'
    },
    FLASHBLADE: {
        name: 'pure-flashblade',
        tooltip: 'Pure FlashBlade'
    }
});

export function getHostsPoolStateIcon(pool) {
    const { mode } = pool;
    const state = hostsPoolModeToStateIcon[mode];
    return isFunction(state) ? state(pool) : state;
}

export function getCloudResourceStateIcon(resource) {
    const { mode } = resource;
    const state = cloudResourceModeToStateIcon[mode];
    return isFunction(state) ? state(resource) : state;
}

export function getCloudResourceTypeIcon(resource) {
    const { type } = resource;
    return cloudAndNamespaceResourceTypeToIcon[type];
}

export function getInternalResourceStateIcon(resource) {
    const { mode } = resource;
    const state = internalResourceModeToStateIcon[mode];
    return isFunction(state) ? state(resource) : state;
}

export function getInternalResourceDisplayName(resource) {
    return resource.name
        .replace(/-pool.*/, '');
}

export function getNamespaceResourceStateIcon(resource) {
    const { mode } = resource;
    return namespaceResourceModeToStateIcon[mode];
}

export function getNamespaceResourceTypeIcon(resource) {
    const { service } = resource;
    return cloudAndNamespaceResourceTypeToIcon[service];
}

export function getResourceStateIcon(resourceType, resource) {
    return true &&
        resourceType === 'HOSTS' && getHostsPoolStateIcon(resource) ||
        resourceType === 'CLOUD' && getCloudResourceStateIcon(resource) ||
        resourceType === 'INTERNAL' && getInternalResourceStateIcon(resource);
}
