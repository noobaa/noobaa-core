/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import { shortString } from 'utils/string-utils';

function cloudPoolInfo(pool_name) {
    const shortenNodeName = '---';
    const shortenPoolName = shortString(pool_name, 30, 8);
    return {
        nodeName: null,
        shortenNodeName,
        replicaLocation: {
            text: shortenPoolName,
            href: null,
            tooltip: pool_name
        },
        node: {
            text: shortenNodeName,
            href: null,
            tooltip: null
        }
    };
}

function mongoPoolInfo(pool_name, node_name) {
    const shortenNodeName = shortString(node_name, 30, 8);
    const shortenPoolName = shortString(pool_name, 30, 8);
    return {
        nodeName: null,
        shortenNodeName,
        replicaLocation: {
            text: shortenPoolName,
            href: null,
            tooltip: pool_name
        },
        node: {
            text: shortenNodeName,
            href: null,
            tooltip: pool_name
        }
    };
}

function serverPoolInfo(pool_name, node_name) {
    const shortenNodeName = shortString(node_name, 30, 8);
    const shortenPoolName = shortString(pool_name, 30, 8);
    return {
        nodeName: node_name,
        shortenNodeName,
        replicaLocation: {
            text: shortenPoolName,
            href: {
                route: 'pool',
                params: {
                    pool: pool_name,
                    tab: null
                }
            },
            tooltip: pool_name
        },
        node: {
            text: shortenNodeName,
            href: {
                route: 'node',
                params: {
                    pool: pool_name,
                    node: node_name,
                    tab: null
                }
            },
            tooltip: node_name
        }
    };
}

export default class BlockRowViewModel extends BaseViewModel {
    constructor({ adminfo }, index, count, poolIconMapping) {
        super();

        const { online, in_cloud_pool, in_mongo_pool, node_name, pool_name } = adminfo;
        let poolInfo;

        this.state = {
            name: online ? 'healthy' : 'problem',
            tooltip: online ? 'Healthy' : 'Problem',
            css: online ? 'success' : 'error'
        };
        this.replica = `Replica ${index + 1} of ${count}`;
        this.resourceType = poolIconMapping()[pool_name] || {};
        this.poolName = pool_name;

        if(in_cloud_pool) {
            poolInfo = cloudPoolInfo(pool_name);
        } else if (in_mongo_pool) {
            poolInfo = mongoPoolInfo(pool_name, node_name);
        } else {
            poolInfo = serverPoolInfo(pool_name, node_name);
        }

        Object.assign(this, poolInfo);
    }
}
