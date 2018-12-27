/* Copyright (C) 2016 NooBaa */

import template from './namespace-buckets-table.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, createCompareFunc, throttle } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { stringifyAmount, includesIgnoreCase } from 'utils/string-utils';
import { getNamespaceBucketStateIcon } from 'utils/bucket-utils';
import { inputThrottle, paginationPageSize } from 'config';
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
        type: 'link',
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

function _mapBucketToRow(bucket, selectedForDelete, system) {
    const { name: bucketName, placement } = bucket;
    const { readFrom, writeTo } = placement;
    const name = {
        text: bucketName,
        href: realizeUri(routes.namespaceBucket, { system, bucket: bucketName })
    };
    const readPolicy = {
        text: stringifyAmount('namespace resource', readFrom.length, 'No'),
        tooltip: {
            template: 'list',
            text: readFrom
        }
    };

    return {
        name,
        state: getNamespaceBucketStateIcon(bucket),
        readPolicy,
        writePolicy: writeTo,
        deleteButton: {
            id: bucketName,
            active: selectedForDelete === bucketName
        }

    };
}

class BucketRowViewModel {
    table = null;
    state = ko.observable();
    name = ko.observable();
    objectCount = ko.observable();
    readPolicy = ko.observable();
    writePolicy = ko.observable();
    deleteButton = {
        text: 'Delete bucket',
        id: ko.observable(),
        active: ko.observable(),
        tooltip: 'Delete Bucket',
        onToggle: id => this.table.onSelectForDelete(id),
        onDelete: id => this.table.onDeleteBucket(id)
    };

    constructor({ table }) {
        this.table = table;
    }
}

class NamespaceBucketsTableViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
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
    rows = ko.observableArray()
        .ofType(BucketRowViewModel, { table: this });


    onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

    selectState(state) {
        return [
            state.namespaceBuckets,
            state.location,
            state.namespaceResources,
            state.accounts,
            state.session && state.session.user
        ];
    }

    mapStateToProps(buckets, location, resources, accounts, user) {
        if (!buckets || !accounts || location.params.tab !== 'namespace-buckets') {
            ko.assignToProps(this, {
                dataReady: false ,
                allowCreateBucket: false
            });

        } else {
            const { pathname, params, query } = location;
            const systemHasResources = Object.keys(resources).length > 0;
            const { filter, sortBy = 'name', selectedForDelete } = query;
            const order = Number(query.order) || 1;
            const page = Number(query.page) || 0;
            const pageStart = page * this.pageSize;
            const { compareKey } = columns.find(column => column.name == sortBy);
            const { canCreateBuckets } = accounts[user];
            const createButtonTooltip = {
                align: 'end',
                text: true &&
                    (!canCreateBuckets && createButtonTooltips.MISSING_PERMISSIONS) ||
                    (!systemHasResources && createButtonTooltips.NO_RESOURCES) ||
                    ''
            };
            const filteredRows = Object.values(buckets)
                .filter(bucket => includesIgnoreCase(bucket.name, filter));
            const rows = filteredRows
                .sort(createCompareFunc(compareKey, order))
                .slice(pageStart, pageStart + this.pageSize)
                .map(bucket => _mapBucketToRow(bucket, selectedForDelete, params.system));

            ko.assignToProps(this, {
                dataReady: true,
                pathname,
                allowCreateBucket: canCreateBuckets && systemHasResources,
                createButtonTooltip,
                filter,
                sorting: { sortBy, order },
                page,
                bucketCount: filteredRows.length,
                selectedForDelete,
                rows
            });
        }
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
        this.dispatch(openCreateNamespaceBucketModal());
    }

    onConnectApplication() {
        this.dispatch(openConnectAppModal());
    }

    onDeleteBucket(bucket) {
        this.dispatch(deleteNamespaceBucket(bucket));
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
        this.dispatch(requestLocation(url));
    }

}

export default {
    viewModel: NamespaceBucketsTableViewModel,
    template: template
};
