/* Copyright (C) 2016 NooBaa */

import template from './buckets-table.html';
import BucketRowViewModel from './bucket-row';
import Observer from 'observer';
import ko from 'knockout';
import { deepFreeze, throttle, createCompareFunc, keyByProperty } from 'utils/core-utils';
import { navigateTo } from 'actions';
import { systemInfo, routeContext } from 'model';
import { inputThrottle } from 'config';
import { state$ } from 'state';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true
    },
    {
        name: 'name',
        label: 'bucket name',
        type: 'link',
        sortable: true
    },
    {
        name: 'fileCount',
        label: 'files',
        sortable: true
    },
    {
        name: 'placementPolicy',
        sortable: true
    },
    {
        name: 'resourcesInPolicy',
        type: 'resources-in-policy',
        sortable: true
    },
    {
        name: 'spilloverUsage',
        sortable: true
    },
    {
        name: 'cloudSync',
        sortable: true
    },
    {
        name: 'usedCapacity',
        label: 'used capacity',
        type: 'capacity',
        sortable: true
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

function generatePlacementSortValue(bucket) {
    const tierName = bucket.tiering.tiers[0].tier;
    const { data_placement, attached_pools } = systemInfo() && systemInfo().tiers.find(
        tier => tier.name === tierName
    );
    return [
        data_placement === 'SPREAD' ? 0 : 1,
        attached_pools.length
    ];
}

const compareAccessors = deepFreeze({
    state: bucket => bucket.writable,
    name: bucket => bucket.name,
    fileCount: bucket => bucket.objectsCount,
    resourcesInPolicy: bucket => bucket.backingResources.resources,
    spilloverUsage: bucket => bucket.backingResources.spillover.usage.size,
    usedCapacity: bucket => bucket.storage.values.used,
    cloudSync: bucket => bucket.cloudSyncStatus,
    placementPolicy: generatePlacementSortValue
});

class BucketsTableViewModel extends Observer {
    constructor() {
        super();

        this.columns = columns;

        const query = ko.pureComputed(
            () => routeContext().query || {}
        );

        this.filter = ko.pureComputed({
            read: () => query().filter,
            write: throttle(phrase => this.filterBuckets(phrase), inputThrottle)
        });

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: query().sortBy || 'name',
                order: Number(query().order) || 1
            }),
            write: value => this.orderBy(value)
        });

        this.rows = ko.observable([]);
        this.deleteGroup = ko.observable();
        this.isCreateBucketWizardVisible = ko.observable(false);

        this.observe(state$.getMany(
            ['nodePools', 'pools'],
            ['cloudResources', 'resources'],
            ['internalResources', 'resources'],
            'buckets'),
            this.onState);
    }

    onState([pools, cloud, internal, buckets]) {
        const bucketsList = Object.values(buckets);

        const { sortBy, order } = this.sorting();
        const compareOp = createCompareFunc(compareAccessors[sortBy], order);
        const poolByName = { ...pools, ...cloud, ...internal };

        const rows = bucketsList
            .filter(
                ({ name }) => name.toLowerCase().includes(
                    (this.filter() || '').toLowerCase()
                )
            )
            .sort(compareOp).map(bucket => (new BucketRowViewModel()).onUpdate({
                bucket,
                poolByName,
                deleteGroup: this.deleteGroup,
                isLastBucket: bucketsList.length === 1
            }));


        for (let i = 0; i < rows.length; ++i) {
            this.rows()[i] = rows[i];
        }

        this.rows().length = rows.length;
        this.rows(this.rows());
    }

    orderBy({ sortBy, order }) {
        this.deleteGroup(null);

        const filter = this.filter() || undefined;
        navigateTo(undefined, undefined, { filter, sortBy, order });
    }

    filterBuckets(phrase) {
        this.deleteGroup(null);

        const params = Object.assign(
            { filter: phrase || undefined },
            this.sorting()
        );

        navigateTo(undefined, undefined, params);
    }

    showCreateBucketWizard() {
        this.isCreateBucketWizardVisible(true);
    }

    hideCreateBucketWizard() {
        this.isCreateBucketWizardVisible(false);
    }
}

export default {
    viewModel: BucketsTableViewModel,
    template: template
};
