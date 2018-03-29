/* Copyright (C) 2016 NooBaa */

import template from './buckets-table.html';
import Observer from 'observer';
import BucketRowViewModel from './bucket-row';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze, flatMap, createCompareFunc, throttle } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { requestLocation, deleteBucket } from 'action-creators';
import { paginationPageSize, inputThrottle } from 'config';
import * as routes from 'routes';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: bucket => bucket.mode
    },
    {
        name: 'name',
        label: 'bucket name',
        type: 'newLink',
        sortable: true,
        compareKey: bucket => bucket.name
    },
    {
        name: 'objectCount',
        label: 'files',
        sortable: true,
        compareKey: bucket => bucket.objectCount
    },
    {
        name: 'placementPolicy',
        sortable: true,
        compareKey: bucket => bucket.placement.policyType
    },
    {
        name: 'resources',
        type: 'resources-cell',
        sortable: true,
        compareKey: bucket => {
            const resources = flatMap(bucket.placement.mirrorSets, ms => ms.resources);
            const useHosts = resources.some(res => res.type === 'HOSTS');
            const useCloud = resources.some(res => res.type === 'CLOUD');
            return Number(useHosts) + Number(useCloud);
        }
    },
    {
        name: 'spilloverUsage',
        sortable: true,
        compareKey: bucket => {
            const { usage } = bucket.spillover || { usage: 0 };
            return toBytes(usage);
        }
    },
    {
        name: 'capacity',
        label: 'used capacity',
        type: 'capacity',
        sortable: true,
        compareKey: bucket => toBytes(bucket.storage.used || 0)
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

class BucketsTableViewModel extends Observer {
    constructor() {
        super();

        this.columns = columns;
        this.pageSize = paginationPageSize;
        this.filter = ko.observable();
        this.sorting = ko.observable();
        this.page = ko.observable();
        this.selectedForDelete = ko.observable();
        this.rows = ko.observableArray();
        this.bucketCount = ko.observable();
        this.bucketsLoaded = ko.observable();
        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

        this.deleteGroup = ko.pureComputed({
            read: this.selectedForDelete,
            write: val => this.onSelectForDelete(val)
        });

        this.observe(state$.getMany('buckets', 'location'), this.onBuckets);
        this.isCreateBucketWizardVisible = ko.observable();
    }

    onBuckets([ buckets, location ]) {
        const { tab = 'data-buckets' } = location.params;
        if (tab !== 'data-buckets') {
            return;
        }

        if (!buckets) {
            this.bucketsLoaded(false);
            return;
        }

        const { filter = '', sortBy = 'name', order = 1, page = 0, selectedForDelete } = location.query;
        const { compareKey } = columns.find(column => column.name === sortBy);
        const pageStart = Number(page) * this.pageSize;
        const bucketList = Object.values(buckets)
            .filter(bucket => !filter || bucket.name.includes(filter.toLowerCase()));

        const { system } = location.params;
        const rowParams = {
            baseRoute: realizeUri(routes.bucket, { system }, {}, true),
            deleteGroup: this.deleteGroup,
            onDelete: this.onDeleteBucket
        };

        const rows = bucketList
            .sort(createCompareFunc(compareKey, order))
            .slice(pageStart, pageStart + this.pageSize)
            .map((bucket, i) => {
                const row = this.rows.get(i) || new BucketRowViewModel(rowParams);
                row.onBucket(bucket);
                return row;
            });

        this.pathname = location.pathname;
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.selectedForDelete(selectedForDelete);
        this.bucketCount(bucketList.length);
        this.rows(rows);
        this.bucketsLoaded(true);
    }

    onFilter(filter) {
        this._query({
            filter: filter,
            page: 0,
            selectedForDelete: null
        });
    }

    onSort(sorting) {
        this._query({
            sorting,
            page: 0,
            selectedForDelete: null
        });
    }

    onPage(page) {
        this._query({
            page,
            selectedForDelete: null
        });
    }

    onSelectForDelete(selected) {
        const selectedForDelete = this.selectedForDelete() === selected ? null : selected;
        this._query({ selectedForDelete });
    }

    onDeleteBucket(name) {
        action$.onNext(deleteBucket(name));
    }

    showCreateBucketWizard() {
        this.isCreateBucketWizardVisible(true);
    }

    hideCreateBucketWizard() {
        this.isCreateBucketWizardVisible(false);
    }

    _query(params) {
        const {
            filter = this.filter(),
            sorting = this.sorting(),
            page = this.page(),
            selectedForDelete = this.selectedForDelete()
        } = params;

        const { sortBy, order } = sorting;
        const query = {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: page,
            selectedForDelete: selectedForDelete || undefined
        };

        action$.onNext(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }
}

export default {
    viewModel: BucketsTableViewModel,
    template: template
};
