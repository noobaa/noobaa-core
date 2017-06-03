/* Copyright (C) 2016 NooBaa */

import { deepFreeze, isFunction, isUndefined } from './core-utils';
import { toBytes, formatSize } from './size-utils';
import numeral from 'numeral';

const nodeStateIconMapping = deepFreeze({
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
    STORAGE_NOT_EXIST: {
        name: 'problem',
        css: 'warning',
        tooltip: 'Unmounted'
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

export function getNodeStateIcon(node) {
    return nodeStateIconMapping[node.mode];
}

const hostsStateIconMapping = deepFreeze({
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
        const { count, by_mode } = pool.nodes;
        const offline = by_mode.OFFLINE || 0;
        const percentage = numeral(offline / count).format('%');

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
    LOW_CAPACITY: {
        tooltip: 'Available capacity is low',
        css: 'warning',
        name: 'problem'
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

const cloudStateIconMapping = deepFreeze({
    OPTIMAL: {
        tooltip: 'Healthy',
        css: 'success',
        name: 'healthy',
    },
    IO_ERRORS: {
        tooltip: 'Resource has Read/Write problems',
        css: 'error',
        name: 'problem',
    },
    STORAGE_NOT_EXIST: resource => {
        const tooltip = resource.cloud_info.endpoint_type === 'AZURE' ?
            'Target Azure container does not exist' :
            'Target S3 bucket does not exist';

        return {
            tooltip,
            css: 'error',
            name: 'problem',
        };
    },
    AUTH_FAILED: {
        tooltip: 'Authentication failure',
        css: 'error',
        name: 'problem',
    },
    INITALIZING: {
        tooltip: 'Initializing',
        css: 'warning',
        name: 'working',
    },
    ALL_NODES_OFFLINE: {
        tooltip: 'Offline',
        css: 'error',
        name: 'problem',
    }
});

const internalStateIconMapping = deepFreeze({
    OPTIMAL: {
        tooltip: 'Healthy',
        css: 'success',
        name: 'healthy',
    },
    ALL_NODES_OFFLINE: {
        tooltip: 'Resource is offline',
        css: 'error',
        name: 'problem',
    },
    IO_ERRORS: {
        tooltip: 'Resource has Read/Write problems',
        css: 'error',
        name: 'problem',
    },
    INITALIZING: {
        name: 'working',
        css: 'warning',
        tooltip: 'Initializing'
    },
});

export function getPoolStateIcon(pool) {
    const { resource_type, mode } = pool;
    const mapping = {
        HOSTS: hostsStateIconMapping,
        CLOUD: cloudStateIconMapping,
        INTERNAL: internalStateIconMapping
    }[resource_type];

    if (!mapping) {
        throw new Error(`Pool state type icon is not supported for resource of type ${resource_type}`);
    }

    const state = mapping[mode];
    return isFunction(state) ? state(pool) : state;
}

const resourceTypeIconMapping = deepFreeze({
    AWS: {
        name: 'aws-s3-resource',
        tooltip: 'AWS S3 resource'
    },

    AZURE: {
        name: 'azure-resource',
        tooltip: 'Azure blob resource'
    },

    S3_COMPATIBLE: {
        name: 'cloud-resource',
        tooltip: 'Generic S3 compatible resource'
    },

    NODES_POOL: {
        name: 'nodes-pool',
        tooltip: 'Nodes pool'
    },

    INTERNAL: {
        name: 'internal-resource',
        tooltip: 'Internal resource'
    },

    CLOUD: {
        name: 'cloud-resources',
        tooltip: 'Cloud resource'
    }
});

export function getResourceTypeIcon(resourceType, subResourceType) {
    const type = {
        HOSTS: () => 'NODES_POOL',
        CLOUD: () => subResourceType ? subResourceType : 'CLOUD',
        INTERNAL: () => 'INTERNAL'
    }[resourceType];

    if (!type) {
        throw new Error(`Resource type icon is not supported for resource of type ${resourceType}`);
    }

    return resourceTypeIconMapping[type()];
}

export function getSystemStorageIcon(storage) {
    const total = toBytes(storage.total);
    const free = toBytes(storage.free);

    if (total === 0) {
        return {
            name: 'problem',
            css: 'disabled',
            tooltip: 'No system storage - add nodes or cloud resources'
        };

    } else if (free < Math.pow(1024, 2)) { // 1MB
        return {
            name: 'problem',
            css: 'error',
            tooltip: 'No free storage left'
        };

    } else {
        const ratio = free / total;
        const tooltip = `${
                numeral(free / total).format('%')
            } free storage left (${
                formatSize(free)
            } of ${
                formatSize(total)
            })`;

        return {
            name: ratio <= .2 ? 'problem' : 'healthy',
            css: ratio <= .2 ? 'warning' : 'success',
            tooltip: tooltip
        };
    }
}

const serviceMapping = deepFreeze({
    AWS: {
        subject: 'Bucket',
        icon: 'aws-s3-resource-dark',
        selectedIcon: 'aws-s3-resource-colored'
    },
    AZURE: {
        subject: 'Container',
        icon: 'azure-resource-dark',
        selectedIcon: 'azure-resource-colored'
    },
    S3_COMPATIBLE: {
        subject: 'Bucket',
        icon: 'cloud-resource-dark',
        selectedIcon: 'cloud-resource-colored'
    }
});

export function getCloudServiceMeta(service) {
    return serviceMapping[service];
}

export function getNodeCapacityBarValues(node) {
    const { storage = {} } = node;
    const { total, used, used_other, reserved } = storage;
    const usage = [
        { value: used, label: 'Used (Noobaa)' },
        { value: used_other, label: 'Used (other)' },
        { value: reserved, label: 'Reserved' }
    ];

    return { total, used: usage };
}

export function getBucketCapacityBarValues(node) {
    const { storage = {} } = node;
    const { total, used, used_other, reserved } = storage.values;
    const usage = [
        { value: used, label: 'Used (Noobaa)' },
        { value: used_other, label: 'Used (other)' },
        { value: reserved || 0, label: 'Reserved' }
    ];

    return { total, used: usage };
}

export function getPoolCapacityBarValues(resource) {
    const { storage = {} } = resource;
    const { total, used, used_other, reserved } = storage;

    const usage = {
        HOSTS: [
            { value: used, label: 'Used (Noobaa)' },
            { value: used_other, label: 'Used (other)' },
            { value: reserved, label: 'Reserved' }
        ],
        CLOUD: used,
        INTERNAL: used
    }[resource.resource_type];

    if (isUndefined(usage)) {
        throw new Error(`Capacity bar values are not supported for resource of type ${resource.resource_type}`);
    }

    return { total, used: usage };
}

export function countNodesByState(modeCoutners) {
    return Object.entries(modeCoutners).reduce(
        (counters, [key, value]) => {
            counters.all += value;
            if (key === 'OPTIMAL') {
                counters.healthy += value;
            } else if (key === 'OFFLINE') {
                counters.offline += value;
            } else {
                counters.hasIssues += value;
            }
            return counters;
        }, { all: 0, healthy: 0, offline: 0, hasIssues: 0 }
    );
}

export function getModeFilterFromState(state) {
    switch (state) {
        case 'HEALTHY':
            return ['OPTIMAL'];

        case 'HAS_ISSUES':
            return [
                'LOW_CAPACITY',
                'NO_CAPACITY',
                'DECOMMISSIONING',
                'MIGRATING',
                'DELETING',
                'DECOMMISSIONED',
                'DELETED',
                'N2N_ERRORS',
                'GATEWAY_ERRORS',
                'IO_ERRORS',
                'STORAGE_NOT_EXIST',
                'UNTRUSTED',
                'INITALIZING'
            ];

        case 'OFFLINE':
            return ['OFFLINE'];
    }
}

const bucketStateIconMapping = deepFreeze({
    NO_RESOURCES: {
        tooltip: 'No available resources',
        css: 'error',
        name: 'problem'
    },
    NOT_ENOUGH_HEALTHY_RESOURCES: {
        tooltip: 'Not enough healthy storage resources',
        css: 'error',
        name: 'problem'
    },
    NO_CAPACITY: {
        tooltip: 'No potential available storage',
        css: 'error',
        name: 'problem'
    },
    EXCEEDING_QOUTA: {
        tooltip: 'Exceeded configured quota',
        css: 'error',
        name: 'problem'
    },
    LOW_CAPACITY: {
        tooltip: 'Storage is low',
        css: 'warning',
        name: 'problem'
    },
    APPROUCHING_QOUTA: {
        tooltip: 'Approuching configured quota',
        css: 'warning',
        name: 'problem'
    },
    OPTIMAL: {
        tooltip: 'Healthy',
        css: 'success',
        name: 'healthy'
    }
});

export function getBucketStateIcon(bucketMode) {
    return bucketStateIconMapping[bucketMode];
}