/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import { shortString } from 'utils/string-utils';

function cloudPoolInfo(pool_name) {
    const shortenNodeName = '---';
    return {
        nodeName: null,
        shortenNodeName,
        replicaLocation: {
            text: pool_name,
            href: null
        },
        node: {
            text: shortenNodeName,
            href: null
        }
    };
}

function serverPoolInfo(pool_name, node_name) {
    const shortenNodeName = shortString(node_name, 30, 8);
    return {
        nodeName: node_name,
        shortenNodeName,
        replicaLocation: {
            text: pool_name,
            href: {
                route: 'pool',
                params: {
                    pool: pool_name,
                    tab: null
                }
            }
        },
        node: {
            text: shortenNodeName,
            href: {
                route: 'host',
                params: {
                    pool: pool_name,
                    host: node_name,
                    tab: null
                }
            }
        }
    };
}

export default class BlockRowViewModel extends BaseViewModel {
    constructor({ adminfo }, index, count, poolIconMapping) {
        super();

        let { online, in_cloud_pool, node_name, pool_name } = adminfo;

        this.state = {
            name: online ? 'healthy' : 'problem',
            tooltip: online ? 'Healthy' : 'Problem',
            css: online ? 'success' : 'error'
        };

        this.replica = `Replica ${index + 1} of ${count}`;
        this.resourceType = poolIconMapping()[pool_name] || {};
        this.poolName = pool_name;
        Object.assign(this, in_cloud_pool ? cloudPoolInfo(pool_name) : serverPoolInfo(pool_name, node_name));
    }
}
