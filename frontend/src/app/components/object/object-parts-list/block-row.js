/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import { shortString } from 'utils/string-utils';
import { getResourceTypeIcon } from 'utils/ui-utils';
import ko from 'knockout';
import { systemInfo } from 'model';

let poolsMapObj = {};

export default class BlockRowViewModel extends BaseViewModel {
    constructor({ adminfo }, index, count) {
        super();

        let { online, in_cloud_pool, node_name, pool_name } = adminfo;

        systemInfo.subscribe(this.updateResourceType);

        this.state = {
            name: online ? 'healthy' : 'problem',
            tooltip: online ? 'Healthy' : 'Problem',
            css: online ? 'success' : 'error'
        };

        this.replica = `Replica ${index + 1} of ${count} ${in_cloud_pool ? '(cloud replica)' : ''}`;


        this.recourseType = ko.observable({});

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

            this.replicaLocation = {
                text: pool_name,
                href: null

            };

            this.node = {
                text: this.shortenNodeName,
                href: null
            };
        }

        this.updateResourceType();
    }

    updateResourceType() {
        const poolName = this.poolName;

        if (!Object.keys(poolsMapObj).length) {
            systemInfo() && systemInfo().pools.map( pool => poolsMapObj[pool.name] = pool );
        }

        const pool = poolsMapObj[poolName];

        if(pool) {
            this.recourseType(getResourceTypeIcon(pool));
        }
    }
}
