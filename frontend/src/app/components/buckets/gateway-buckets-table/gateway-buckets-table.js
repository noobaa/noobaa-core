/* Copyright (C) 2016 NooBaa */

import template from './gateway-buckets-table.html';
import Observer from 'observer';
import BucketRowViewModel from './bucket-row';
import ko from 'knockout';
import { deepFreeze, createCompareFunc, throttle } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { state$, action$ } from 'state';
import { inputThrottle, paginationPageSize } from 'config';
import * as routes from 'routes';
import {
    openCreateGatewayBucketModal,
    requestLocation,
    deleteGatewayBucket
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

const noNamespaceResourceTooltip = 'At least one namespace resoruce is needed. Please create a namespace resource in the resources section.';

class GatewayBucketsTableViewModel extends Observer {
    constructor() {
        super();

        this.pageSize = paginationPageSize;
        this.columns = columns;
        this.pathname = '';
        this.allowCreateBucket = ko.observable();
        this.createButtonTooltip = ko.observable();
        this.sorting = ko.observable();
        this.filter = ko.observable();
        this.page = ko.observable();
        this.selectedForDelete = ko.observable();
        this.bucketCount = ko.observable();
        this.rows = ko.observableArray();
        this.bucketsLoaded = ko.observable();
        this.rowParams = {
            deleteGroup: ko.pureComputed({
                read: this.selectedForDelete,
                write: this.onSelectForDelete,
                owner: this
            }),
            onDelete: this.onDeleteBucket.bind(this)
        };

        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

        this.observe(
            state$.getMany(
                'gatewayBuckets',
                'location',
                'namespaceResources'
            ),
            this.onBuckets
        );
    }

    onBuckets([ buckets, location, resources ]) {
        const { pathname, params, query } = location;
        if (!buckets || params.tab !== 'gateway-buckets') {
            this.allowCreateBucket(false);
            this.bucketsLoaded(Boolean(buckets));
            return;
        }

        const systemHasResources = Object.keys(resources).length > 0;
        const createButtonTooltip = systemHasResources ? '' : noNamespaceResourceTooltip;
        const { filter, sortBy = 'name', order = 1, page = 0, selectedForDelete } = query;
        const pageStart = Number(page) * this.pageSize;
        const { compareKey } = columns.find(column => column.name == sortBy);
        const bucketRoute = realizeUri(routes.gatewayBucket, { system: params.system }, {}, true);

        const filteredRows = Object.values(buckets)
            .filter(bucket => !filter || bucket.name.includes(filter.toLowerCase()));

        const rows = filteredRows
            .sort(createCompareFunc(compareKey, order))
            .slice(pageStart, pageStart + this.pageSize)
            .map((bucket, i) => {
                const row = this.rows()[i] || new BucketRowViewModel(this.rowParams);
                row.onBucket(bucket, bucketRoute);
                return row;
            });

        this.pathname = pathname;
        this.allowCreateBucket(systemHasResources);
        this.createButtonTooltip(createButtonTooltip);
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.bucketCount(filteredRows.length);
        this.selectedForDelete(selectedForDelete);
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
        const selectedForDelete = this.selectedForDelete() === bucket ? null : bucket;
        this._query({ selectedForDelete });
    }

    onPage(page) {
        this._query({
            page: page,
            selectedForDelete: null
        });
    }

    onCreate() {
        action$.onNext(openCreateGatewayBucketModal());
    }

    onDeleteBucket(bucket) {
        action$.onNext(deleteGatewayBucket(bucket));
    }

    _query({
        filter = this.filter(),
        sorting = this.sorting(),
        page = this.page(),
        selectedForDelete = this.selectedForDelete()
    }) {
        const query = {
            filter: filter || undefined,
            sortBy: sorting.sortBy,
            order: sorting.order,
            page: page,
            selectedForDelete: selectedForDelete || undefined
        };

        const url = realizeUri(this.pathname, {}, query);
        action$.onNext(requestLocation(url));
    }

}

export default {
    viewModel: GatewayBucketsTableViewModel,
    template: template
};
