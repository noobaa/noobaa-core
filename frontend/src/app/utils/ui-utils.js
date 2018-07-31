/* Copyright (C) 2016 NooBaa */

import { deepFreeze, isFunction, isUndefined } from './core-utils';
import { getHostsPoolStateIcon } from './resource-utils';

const resourceStateIconMapping = deepFreeze({
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
        const tooltip = resource.cloud_info.endpoint_type === 'AZURE' ?
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
        name: 'aws-s3',
        tooltip: 'AWS S3 resource'
    },

    AZURE: {
        name: 'azure',
        tooltip: 'Azure blob resource'
    },

    GOOGLE: {
        name: 'google-cloud',
        tooltip: 'Google Cloud Resource'
    },

    S3_COMPATIBLE: {
        name: 'cloud',
        tooltip: 'Generic S3 compatible resource'
    },

    FLASHBLADE: {
        name: 'pure-flashblade',
        tooltip: 'Pure FlashBlade resource'
    },

    NODES_POOL: {
        name: 'nodes-pool',
        tooltip: 'Nodes Pool'
    },

    INTERNAL_STORAGE: {
        name: 'internal-storage',
        tooltip: 'Internal Storage'
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
