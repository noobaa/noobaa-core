/* Copyright (C) 2016 NooBaa */

import template from './namespace-buckets-table.html';
import Observer from 'observer';
import BucketRowViewModel from './bucket-row';
import ko from 'knockout';
import { deepFreeze, createCompareFunc, throttle } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { state$, action$ } from 'state';
import { inputThrottle, paginationPageSize } from 'config';
import { getMany } from 'rx-extensions';
import * as routes from 'routes';
import {
    openCreateNamespaceBucketModal,
    openConnectAppModal,
    requestLocation,
    deleteNamespaceBucket
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
        name: 'readPolicy',
        sortable: true,
        compareKey: bucket => bucket.placement.readFrom.length
    },
    {
        name: 'writePolicy',
        sortable: true,
        compareKey: bucket => bucket.placement.writeTo
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

const createButtonTooltips = deepFreeze({
    MISSING_PERMISSIONS: 'The current account is not allowed to create new buckets in the system. To grant permissions, edit the account\'s S3 access in the account page',
    NO_RESOURCES: 'At least one namespace resoruce is needed. Please create a namespace resource in the resources section.'
});

class NamespaceBucketsTableViewModel extends Observer {
    pageSize = paginationPageSize;
    columns = columns;
    pathname = '';
    allowCreateBucket = ko.observable();
    createButtonTooltip = ko.observable();
    sorting = ko.observable();
    filter = ko.observable();
    page = ko.observable();
    selectedForDelete = ko.observable();
    bucketCount = ko.observable();
    rows = ko.observableArray();
    bucketsLoaded = ko.observable();
    rowParams = {
        onSelectForDelete: this.onSelectForDelete.bind(this),
        onDelete: this.onDeleteBucket.bind(this)
    };

    onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'namespaceBuckets',
                    'location',
                    'namespaceResources',
                    'accounts',
                    ['session', 'user']
                )
            ),
            this.onBuckets
        );
    }

    onBuckets([ buckets, location, resources, accounts, user ]) {
        const { pathname, params, query } = location;
        if (!buckets || !accounts || params.tab !== 'namespace-buckets') {
            this.allowCreateBucket(false);
            this.bucketsLoaded(Boolean(buckets));
            return;
        }

        const systemHasResources = Object.keys(resources).length > 0;
        const { filter, sortBy = 'name', order = 1, page = 0, selectedForDelete } = query;
        const pageStart = Number(page) * this.pageSize;
        const { compareKey } = columns.find(column => column.name == sortBy);
        const bucketRoute = realizeUri(routes.namespaceBucket, { system: params.system }, {}, true);
        const { canCreateBuckets } = accounts[user];
        const createButtonTooltip = {
            align: 'end',
            text: true &&
                (!canCreateBuckets && createButtonTooltips.MISSING_PERMISSIONS) ||
                (!systemHasResources && createButtonTooltips.NO_RESOURCES) ||
                ''
        };

        const filteredRows = Object.values(buckets)
            .filter(bucket => !filter || bucket.name.includes(filter.toLowerCase()));

        const rows = filteredRows
            .sort(createCompareFunc(compareKey, order))
            .slice(pageStart, pageStart + this.pageSize)
            .map((bucket, i) => {
                const row = this.rows()[i] || new BucketRowViewModel(this.rowParams);
                row.onBucket(bucket, bucketRoute, selectedForDelete);
                return row;
            });

        this.pathname = pathname;
        this.allowCreateBucket(canCreateBuckets && systemHasResources);
        this.createButtonTooltip(createButtonTooltip);
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.bucketCount(filteredRows.length);
        this.selectedForDelete = selectedForDelete;
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
            sorting: sorting,
            page: 0,
            selectedForDelete: null
        });
    }

    onSelectForDelete(bucket) {
        this._query({ selectedForDelete: bucket });
    }

    onPage(page) {
        this._query({
            page: page,
            selectedForDelete: null
        });
    }

    onCreate() {
        action$.next(openCreateNamespaceBucketModal());
    }

    onConnectApplication() {
        action$.next(openConnectAppModal());
    }

    onDeleteBucket(bucket) {
        action$.next(deleteNamespaceBucket(bucket));
    }

    _query({
        filter = this.filter(),
        sorting = this.sorting(),
        page = this.page(),
        selectedForDelete = this.selectedForDelete
    }) {
        const query = {
            filter: filter || undefined,
            sortBy: sorting.sortBy,
            order: sorting.order,
            page: page,
            selectedForDelete: selectedForDelete || undefined
        };

        const url = realizeUri(this.pathname, {}, query);
        action$.next(requestLocation(url));
    }

}

export default {
    viewModel: NamespaceBucketsTableViewModel,
    template: template
};
