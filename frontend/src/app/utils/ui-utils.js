import { deepFreeze, isFunction } from './core-utils';
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

export function getNodeStateIcon(node) {
    return nodeStateIconMapping[node.mode];
}

const poolStateIconMapping = deepFreeze({
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
    NOT_ENOUGH_HEALTHY_NODES: {
        tooltip: 'Not enough healthy nodes',
        css: 'error',
        name: 'problem'
    },
    MANY_NODES_OFFLINE: pool => {
        const { count, online, has_issues } = pool.nodes;
        const percentage = numeral(1 - ((online + has_issues) / count)).format('%');
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

export function getPoolStateIcon(pool) {
    const state = poolStateIconMapping[pool.mode];
    return isFunction(state) ? state(pool) : state;
}

const resourceTypeStateMapping = deepFreeze({
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
    }
});

export function getResourceTypeIcon(resource) {
    return resourceTypeStateMapping[
        resource.nodes ? 'NODES_POOL' : resource.cloud_info.endpoint_type
    ];
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

export function getPoolCapacityBarValues(pool) {
    const { storage = {} } = pool;
    const { total, used, used_other, reserved } = storage;
    const usage = pool.cloud_info ? used : [
        { value: used, label: 'Used (Noobaa)' },
        { value: used_other, label: 'Used (other)' },
        { value: reserved, label: 'Reserved' }
    ];

    return { total, used: usage };
}
