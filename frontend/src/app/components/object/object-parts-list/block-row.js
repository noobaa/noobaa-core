/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import { getHostDisplayName } from 'utils/host-utils';
import { shortString } from 'utils/string-utils';

export default class BlockRowViewModel extends BaseViewModel {
    constructor({ adminfo }, index, count, poolIconMapping) {
        super();

        let { online, in_cloud_pool, in_mongo_pool, node_name, pool_name } = adminfo;

        this.state = {
            name: online ? 'healthy' : 'problem',
            tooltip: online ? 'Healthy' : 'Problem',
            css: online ? 'success' : 'error'
        };

        this.replica = `Replica ${index + 1} of ${count}`;
        this.resourceType = poolIconMapping()[pool_name] || {};
        this.poolName = pool_name;

        if (in_cloud_pool || in_mongo_pool) {
            this.nodeName = null;
            this.node = '---';
            this.replicaLocation = {
                text: in_mongo_pool ? 'Internal Storage' : pool_name,
                tooltip: pool_name
            };

        } else {
            const shortenNodeName = shortString(getHostDisplayName(node_name), 30, 8);
            this.nodeName = node_name;
            this.node = {
                text: shortenNodeName,
                href: {
                    route: 'host',
                    params: {
                        pool: pool_name,
                        host: node_name,
                        tab: null
                    }
                },
                tooltip: node_name
            };
            this.replicaLocation = {
                text: pool_name,
                href: {
                    route: 'pool',
                    params: {
                        pool: pool_name,
                        tab: null
                    }
                },
                tooltip: pool_name
            };

        }
    }
}
