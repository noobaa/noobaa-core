/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import numeral from 'numeral';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import {
    getHostsPoolStateIcon,
    getCloudResourceStateIcon,
    getCloudResourceTypeIcon
} from 'utils/resource-utils';

export default class PlacementRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.type = ko.observable();
        this.resourceName = ko.observable();
        this.onlineHostCount = ko.observable();
        this.bucketUsage = ko.observable();
    }

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
        const { hostCount, hostsByMode } = pool;
        const onlineHostCount = numeral(hostCount - (hostsByMode.OFFLINE || 0)).format('0,0');
        const poolUri = realizeUri(routes.pool, { system, pool: pool.name });

        this.resourceName({
            text: pool.name,
            tooltip: pool.name,
            href: poolUri
        });

        this.state(getHostsPoolStateIcon(pool));
        this.type('nodes-pool');
        this.onlineHostCount(onlineHostCount);
        this.bucketUsage({
            total: pool.storage.total,
            used: bucketUsage
        });
    }

    _onCloudResource(resource, bucketUsage) {
        this.resourceName(resource.name);
        this.state(getCloudResourceStateIcon(resource));
        this.type(getCloudResourceTypeIcon(resource));
        this.onlineHostCount('---');
        this.bucketUsage({
            total: resource.storage.total,
            used: bucketUsage
        });
    }
}
