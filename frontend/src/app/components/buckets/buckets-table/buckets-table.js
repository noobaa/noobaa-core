/* Copyright (C) 2016 NooBaa */

import template from './buckets-table.html';
import BucketRowViewModel from './bucket-row';
import Observer from 'observer';
import ko from 'knockout';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import { aggregateStorage } from 'utils/storage-utils';
import { navigateTo } from 'actions';
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
    const { type, resources } = bucket.backingResources;

    return [
        type === 'SPREAD' ? 0 : 1,
        resources.length
    ];
}

function spilloverUsage(bucket) {
    return aggregateStorage(
        ...bucket.backingResources.spillover
            .map(s => ({ used: s.used }))
    ).used;
}

const compareAccessors = deepFreeze({
    state: bucket => bucket.writable,
    name: bucket => bucket.name,
    fileCount: bucket => bucket.objectsCount,
    resourcesInPolicy: bucket => bucket.backingResources.resources,
    spilloverUsage: spilloverUsage,
    usedCapacity: bucket => bucket.storage.values.used,
    cloudSync: bucket => bucket.cloudSyncStatus,
    placementPolicy: generatePlacementSortValue
});

class BucketsTableViewModel extends Observer {
    constructor() {
        super();

        this.columns = columns;
        this.filter = ko.observable();
        this.sorting = ko.observable();
        this.rows = ko.observable([]);
        this.deleteGroup = ko.observable();
        this.isCreateBucketWizardVisible = ko.observable(false);

        this.observe(
            state$.getMany(
                ['nodePools', 'pools'],
                ['cloudResources', 'resources'],
                ['internalResources', 'resources'],
                'buckets',
                ['location', 'query']
            ),
            this.onState
        );
    }

    onState([pools, cloud, internal, buckets, query]) {
        const bucketsList = Object.values(buckets);
        const { filter } = query;

        const poolByName = { ...pools, ...cloud, ...internal };
        const canSort = Object.keys(compareAccessors).includes(query.sortBy);
        const sortBy = (canSort && query.sortBy) || 'name';
        const order = (canSort && Number(query.order)) || 1;

        const compareOp = createCompareFunc(compareAccessors[sortBy], order);
        const sortedBuckets = bucketsList
            .filter(
                ({ name }) => name.toLowerCase().includes(
                    (filter || '').toLowerCase()
                )
            )
            .sort(compareOp);

        this.rows(sortedBuckets.map((bucket, i) => {
            const row = this.rows()[i] || new BucketRowViewModel();
            row.onUpdate({
                bucket,
                poolByName,
                deleteGroup: this.deleteGroup,
                isLastBucket: bucketsList.length === 1
            });
            return row;
        }));

        this.filter(filter);
        this.sorting({ sortBy, order });
    }

    showCreateBucketWizard() {
        this.isCreateBucketWizardVisible(true);
    }

    hideCreateBucketWizard() {
        this.isCreateBucketWizardVisible(false);
    }

    filterBuckets() {
        return ko.pureComputed({
            read: this.filter,
            write: throttle(phrase => {
                const { sortBy, order } = this.sorting();
                const filter = phrase || undefined;

                this.deleteGroup(null);
                navigateTo(undefined, undefined, { filter, sortBy, order });
            }, inputThrottle)
        });
    }

    orderBy() {
        return ko.pureComputed({
            read: () => ({
                sortBy: this.sorting().sortBy,
                order: Number(this.sorting().order)
            }),
            write: ({ sortBy, order }) => {
                const filter = this.filter();

                this.deleteGroup(null);
                navigateTo(undefined, undefined, { filter, sortBy, order });
            }
        });
    }
}

export default {
    viewModel: BucketsTableViewModel,
    template: template
};
