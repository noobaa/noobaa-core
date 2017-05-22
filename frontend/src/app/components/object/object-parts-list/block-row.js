/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import { shortString } from 'utils/string-utils';
import { getResourceTypeIcon } from 'utils/ui-utils';
import { systemInfo } from 'model';

const poolsMapObj = {};
const poolsMap = () => {
    if (!Object.keys(poolsMapObj).length) {
        systemInfo() && systemInfo().pools.map( pool => poolsMapObj[pool.name] = pool );
    }
    return poolsMapObj;
};

export default class BlockRowViewModel extends BaseViewModel {
    constructor({ adminfo }, index, count) {
        super();

        let { online, in_cloud_pool, node_name, pool_name } = adminfo;

        this.state = {
            name: online ? 'healthy' : 'problem',
            tooltip: online ? 'Healthy' : 'Problem',
            css: online ? 'success' : 'error'
        };

        this.replica = `Replica ${index + 1} of ${count} ${in_cloud_pool ? '(cloud replica)' : ''}`;

        this.pool = poolsMap()[pool_name];

        this.recourseType = getResourceTypeIcon(this.pool);

        this.poolName = pool_name;

        if (!in_cloud_pool) {
            this.nodeName = node_name;
            this.shortenNodeName = shortString(node_name, 30, 8);

            this.replicaLocation = {
                text: pool_name,
                href: {
                    route: 'pool',
                    params: {
                        pool: pool_name,
                        tab: null
                    }
                }
            };

            this.node = {
                text: this.shortenNodeName,
                href: {
                    route: 'node',
                    params: {
                        pool: pool_name,
                        node: node_name,
                        tab: null
                    }
                }
            };

        } else {
            this.nodeName = null;
            this.shortenNodeName = '---';
            this.replicaLocation = null;
            this.node = null;
        }
    }
}