/* Copyright (C) 2016 NooBaa */

import template from './buckets-table.html';
import BucketRowViewModel from './bucket-row';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import { navigateTo } from 'actions';
import { systemInfo, routeContext } from 'model';
import { inputThrottle } from 'config';

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
        name: 'cloudStorage',
        type: 'cloud-storage'
    },
    {
        name: 'cloudSync',
        sortable: true
    },
    {
        name: 'capacity',
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
    state: bucket => bucket.mode,
    name: bucket => bucket.name,
    fileCount: bucket => bucket.num_objects,
    capacity: bucket => bucket.storage.values.used,
    cloudSync: bucket => bucket.cloud_sync_status,
    placementPolicy: generatePlacementSortValue
});

class BucketsTableViewModel extends BaseViewModel {
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

        this.buckets = ko.pureComputed(
            () => {
                const { sortBy, order } = this.sorting();
                const compareOp = createCompareFunc(compareAccessors[sortBy], order);

                return systemInfo() && systemInfo().buckets
                    .filter(
                        ({ name }) => name.toLowerCase().includes(
                            (this.filter() || '').toLowerCase()
                        )
                    )
                    .sort(compareOp);
            }
        );

        this.hasSingleBucket = ko.pureComputed(
            () => systemInfo() && systemInfo().buckets.length === 1
        );

        this.deleteGroup = ko.observable();
        this.isCreateBucketWizardVisible = ko.observable(false);
    }

    newBucketRow(bucket) {
        return new BucketRowViewModel(
            bucket,
            this.deleteGroup,
            this.hasSingleBucket
        );
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
