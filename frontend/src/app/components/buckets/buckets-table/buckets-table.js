/* Copyright (C) 2016 NooBaa */

import template from './buckets-table.html';
import Observer from 'observer';
import BucketRowViewModel from './bucket-row';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze, flatMap, createCompareFunc, throttle } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { paginationPageSize, inputThrottle } from 'config';
import * as routes from 'routes';
import { getMany } from 'rx-extensions';
import {
    requestLocation,
    deleteBucket,
    openCreateBucketModal,
    openConnectAppModal
} from 'action-creators';

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

const createButtondDisabledTooltip = deepFreeze({
    text: 'The current account is not allowed to create new buckets in the system. To grant permissions, edit the account\'s S3 access in the account page',
    align: 'end'
});

class BucketsTableViewModel extends Observer {
    columns = columns;
    pageSize = paginationPageSize;
    filter = ko.observable();
    sorting = ko.observable();
    page = ko.observable();
    selectedForDelete = ko.observable();
    rows = ko.observableArray();
    bucketCount = ko.observable();
    bucketsLoaded = ko.observable();
    onFilterThrottled = throttle(this.onFilter, inputThrottle, this);
    deleteGroup = ko.pureComputed({
        read: this.selectedForDelete,
        write: val => this.onSelectForDelete(val)
    });
    createBucketTooltip = ko.observable();
    isCreateBucketDisabled = ko.observable();

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'buckets',
                    'location',
                    'accounts',
                    ['session', 'user']
                )
            ),
            this.onState
        );
    }

    onState([ buckets, location, accounts, user ]) {
        const { tab = 'data-buckets' } = location.params;
        if (tab !== 'data-buckets') {
            return;
        }

        if (!buckets) {
            this.bucketsLoaded(false);
            this.isCreateBucketDisabled(true);
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
                row.onState(bucket, system);
                return row;
            });

        const { canCreateBuckets } = accounts[user];
        const createBucketTooltip = canCreateBuckets ? '' : createButtondDisabledTooltip;

        this.pathname = location.pathname;
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.selectedForDelete(selectedForDelete);
        this.bucketCount(bucketList.length);
        this.rows(rows);
        this.bucketsLoaded(true);
        this.createBucketTooltip(createBucketTooltip);
        this.isCreateBucketDisabled(!canCreateBuckets);
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
        action$.next(deleteBucket(name));
    }

    onCreateBucket() {
        action$.next(openCreateBucketModal());
    }

    onConnectApplication() {
        action$.next(openConnectAppModal());
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

        action$.next(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }
}

export default {
    viewModel: BucketsTableViewModel,
    template: template
};
