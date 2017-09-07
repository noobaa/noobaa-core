/* Copyright (C) 2016 NooBaa */

import { deepFreeze, isFunction, isUndefined } from './core-utils';
import { toBytes, formatSize } from './size-utils';
import { getHostsPoolStateIcon } from './resource-utils';
import numeral from 'numeral';

const resourceStateIconMapping = deepFreeze({
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
    INITIALIZING: {
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

export function getPoolStateIcon(pool) {
    const { resource_type, mode } = pool;
    switch (resource_type) {
        case 'HOSTS': {
            // Use the new getHostsPoolStateIcon resource util to get the state icon
            // shiming the state tree host pool entity (only relevent information).
            const shim = {
                mode: pool.mode,
                hostCount: pool.hosts.count,
                hostsByMode: pool.hosts.by_mode,
                storage: pool.storage
            };

            return getHostsPoolStateIcon(shim);
        }

        case 'CLOUD': {
            const state = resourceStateIconMapping[mode];
            return isFunction(state) ? state(pool) : state;
        }

        default: {
            throw new Error(`Pool state type icon is not supported for resource of type ${resource_type}`);
        }
    }
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
        tooltip: 'Nodes Pool'
    },

    INTERNAL_STORAGE: {
        name: 'internal-storage',
        tooltip: 'Internal Stroage'
    }
});

export function getResourceTypeIcon({ resource_type, cloud_info }) {
    const type = {
        HOSTS: () => 'NODES_POOL',
        CLOUD: () => cloud_info.endpoint_type,
        INTERNAL: () => 'INTERNAL_STORAGE'
    }[resource_type];

    if (!type) {
        throw new Error(`Resource type icon is not supported for resource of type ${resource_type}`);
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

export function getPoolCapacityBarValues(resource) {
    const { storage = {} } = resource;
    const { total, used, used_other, reserved } = storage;

    const usage = {
        HOSTS: [
            { value: used, label: 'Used (Noobaa)' },
            { value: used_other, label: 'Used (other)' },
            { value: reserved, label: 'Reserved' }
        ],
        CLOUD: used
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

