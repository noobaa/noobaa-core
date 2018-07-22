/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import numeral from 'numeral';
import * as routes from 'routes';
import { deepFreeze, sumBy } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { hostWritableModes, storageNodeWritableModes } from 'utils/host-utils';
import {
    getHostsPoolStateIcon,
    getCloudResourceStateIcon,
    getCloudResourceTypeIcon
} from 'utils/resource-utils';

const nodesPoolType = deepFreeze({
    name: 'nodes-pool',
    tooltip: 'Nodes Pool'
});

function _formatCounts(some, all) {
    return `${
        numeral(some).format('0,0')
    } of ${
        numeral(all).format('0,0')
    }`;
}

export default class PlacementRowViewModel {
    state = ko.observable();
    type = ko.observable();
    resourceName = ko.observable();
    region = ko.observable();
    healthyHosts = ko.observable();
    healthyNodes = ko.observable();
    bucketUsage = ko.observable();

    onResource(type, resource, usage, system) {
        switch (type) {
            case 'HOSTS': {
                this._onHostPool(resource, usage, system);
                break;
            }

            case 'CLOUD': {
                this._onCloudResource(resource, usage, system);
                break;
            }
        }
    }

    _onHostPool(pool, bucketUsage, system) {
        const { hostCount, hostsByMode, storageNodeCount, storageNodesByMode } = pool;
        const healthyHosts = sumBy(
            hostWritableModes,
            mode => hostsByMode[mode] || 0
        );
        const healthyNodes = sumBy(
            storageNodeWritableModes,
            mode => storageNodesByMode[mode] || 0
        );
        const resourceName = {
            text: pool.name,
            tooltip: { text: pool.name, breakWords: true },
            href: realizeUri(routes.pool, { system, pool: pool.name })
        };

        this.resourceName(resourceName);
        this.state(getHostsPoolStateIcon(pool));
        this.type(nodesPoolType);
        this.region(pool.region || '(Unassigned)');
        this.healthyHosts(_formatCounts(healthyHosts, hostCount));
        this.healthyNodes(_formatCounts(healthyNodes, storageNodeCount));
        this.bucketUsage({
            total: pool.storage.total,
            used: bucketUsage
        });
    }

    _onCloudResource(resource, bucketUsage, system) {
        const resourceName = {
            text: resource.name,
            tooltip: { text: resource.name, breakWords: true },
            href: realizeUri(routes.cloudResource, { system, resource: resource.name })
        };

        this.resourceName(resourceName);
        this.state(getCloudResourceStateIcon(resource));
        this.type(getCloudResourceTypeIcon(resource));
        this.region(resource.region || '(Unassigned)');
        this.healthyHosts('---');
        this.healthyNodes('---');
        this.bucketUsage({
            total: resource.storage.total,
            used: bucketUsage
        });
    }
}
