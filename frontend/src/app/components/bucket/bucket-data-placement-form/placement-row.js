/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { getPoolStateIcon, getResourceTypeIcon, 
    getPoolCapacityBarValues } from 'utils/ui-utils';

export default class PlacementRowViewModel {
    constructor(pool) {
        this.state = ko.pureComputed(
            () => pool() ? getPoolStateIcon(pool()) : ''
        );

        this.type = ko.pureComputed(
            () => pool() ? getResourceTypeIcon(pool().resource_type, pool().cloud_info) : ''
        );

        this.resourceName = ko.pureComputed(
            () => {
                if (!pool()) {
                    return {};
                }

                const text = pool().name;
                if (pool().resource_type === 'HOSTS') {
                    const href = {
                        route: 'pool',
                        params: { pool: text, tab: null }
                    };

                    return { text, href };

                } else {
                    return { text };
                }
            }
        );

        this.onlineNodeCount = ko.pureComputed(
            () => {
                if (!pool()) {
                    return '';
                }

                return pool().resource_type === 'HOSTS' ?
                    `${pool().nodes.online} of ${pool().nodes.count}` :
                    '—';
            }
        );

        this.capacity = ko.pureComputed(
            () => getPoolCapacityBarValues(pool() || {})
        );
    }
}
