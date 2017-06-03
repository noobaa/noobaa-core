/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-placement-table.html';
import PlacementRowViewModel from './placement-row';
import ko from 'knockout';
import Observer from 'observer';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze } from 'utils/core-utils';
import * as routes from 'routes';
import { getPoolStateIcon, getResourceTypeIcon, getPoolCapacityBarValues } from 'utils/ui-utils';
import { state$ } from 'state';

const placementTableColumns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'type',
        type: 'icon'
    },
    {
        name: 'resourceName',
        type: 'custom-link'
    },
    {
        name: 'onlineNodeCount',
        label: 'online nodes in pool'
    },
    {
        name: 'capacity',
        label: 'Resource Capacity',
        type: 'capacity'
    }
]);

class BucketDataPlacementTableViewModel extends Observer {
    constructor({ bucketName }) {
        super();

        this.placementTableColumns = placementTableColumns;
        this.bucketName =  bucketName;
        this.rows = ko.observable([]);

        this.observe(
            state$.getMany(
                ['buckets', ko.unwrap(bucketName)],
                ['nodePools', 'pools'],
                ['cloudResources', 'resources'],
                ['location', 'params', 'system']
            ),
            this.onBucket
        );
    }

    onBucket([bucket, pools, cloudResources, system]) {
        if(!bucket) return;

        this.rows(bucket.backingResources.resources.map((resource, i) => {
            const pool = resource.type === 'HOSTS' ? pools[resource.name] : cloudResources[resource.name];
            const row = this.rows()[i] || new PlacementRowViewModel();
            row.onUpdate({
                state: getPoolStateIcon({ ...pool, resource_type: resource.type }),
                type: getResourceTypeIcon(resource.type),
                name: resource.name,
                url: resource.type === 'HOSTS' ? realizeUri(routes.pool, {
                    system,
                    pool: resource.name,
                }) : '',
                onlineNodeCount: resource.type === 'HOSTS' ? '??? of ???' : '—', // TODO online nodes count of total count
                capacity: getPoolCapacityBarValues({...pool, resource_type: resource.type})
            });

            return row;
        }));
    }
}

export default {
    viewModel: BucketDataPlacementTableViewModel,
    template: template
};
