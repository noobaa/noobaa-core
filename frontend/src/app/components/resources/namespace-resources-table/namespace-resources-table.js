/* Copyright (C) 2016 NooBaa */

import template from './namespace-resources-table.html';
import Observer from 'observer';
import ResourceRowViewModel from './resource-row';
import ko from 'knockout';
import { state$, action$ } from 'state';
import { deepFreeze, createCompareFunc, throttle } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getMany } from 'rx-extensions';
import { inputThrottle, paginationPageSize } from 'config';
import {
    openCreateNamespaceResourceModal,
    requestLocation,
    deleteNamespaceResource
} from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: resource => resource.state
    },
    {
        name: 'type',
        type: 'icon',
        sortable: true,
        compareKey: resource => resource.type
    },
    {
        name: 'name',
        label: 'Resource name',
        sortable: true,
        compareKey: resource => resource.name
    },
    {
        name: 'connectedBuckets',
        label: 'Namespace Buckets Using Resource',
        sortable: true,
        compareKey: (resource, connectedBucketsMap) => {
            const { name } = resource;
            return (connectedBucketsMap[name] || []).length;
        }
    },
    {
        name: 'target',
        label: 'Cloud Target Bucket',
        sortable: true,
        compareKey: resource => resource.target
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

class NamespaceResourceTableViewModel extends Observer {
    constructor() {
        super();

        this.pageSize = paginationPageSize;
        this.columns = columns;
        this.pathname = '';
        this.sorting = ko.observable();
        this.filter = ko.observable();
        this.page = ko.observable();
        this.selectedForDelete = '';
        this.resourceCount = ko.observable();
        this.rows = ko.observableArray();
        this.resourcesLoaded = ko.observable();
        this.rowParams = {
            onSelectForDelete: this.onSelectForDelete.bind(this),
            onDelete: this.onDeleteResource.bind(this)
        };

        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

        this.observe(
            state$.pipe(
                getMany(
                    'namespaceResources',
                    'namespaceBuckets',
                    'location'
                )
            ),
            this.onState
        );
    }

    onState([ resources, buckets, location ]) {
        if (!resources || !buckets || location.params.tab !== 'namespace') {
            this.resourcesLoaded(Boolean(resources));
            return;
        }

        const { filter, sortBy = 'name', order = 1, page = 0, selectedForDelete } = location.query;
        const pageStart = Number(page) * this.pageSize;
        const { compareKey } = columns.find(column => column.name == sortBy);

        const connectedBucketsMap = Object.values(buckets)
            .reduce((connectedBucketsMap, bucket) => {
                const { name, placement } = bucket;
                placement.readFrom
                    .map(resource => {
                        let bucketList = connectedBucketsMap[resource];
                        if (!bucketList) bucketList = connectedBucketsMap[resource] = [];
                        bucketList.push(name);
                    });

                return connectedBucketsMap;
            }, {});

        const filteredRows = Object.values(resources)
            .filter(resource => !filter || resource.name.includes(filter.toLowerCase()));

        const rows = filteredRows
            .sort(createCompareFunc(compareKey, order, connectedBucketsMap))
            .slice(pageStart, pageStart + this.pageSize)
            .map((resource, i) => {
                const row = this.rows()[i] || new ResourceRowViewModel(this.rowParams);
                const connectedBuckets = connectedBucketsMap[resource.name] || [];
                row.onState(resource, connectedBuckets, location.params.system, selectedForDelete);
                return row;
            });

        this.pathname = location.pathname;
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.resourceCount(filteredRows.length);
        this.selectedForDelete = selectedForDelete;
        this.rows(rows);
        this.resourcesLoaded(true);
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

    onSelectForDelete(resource) {
        this._query({ selectedForDelete: resource });
    }

    onPage(page) {
        this._query({
            page: page,
            selectedForDelete: null
        });
    }

    onCreate() {
        action$.next(openCreateNamespaceResourceModal());
    }

    onDeleteResource(resource) {
        action$.next(deleteNamespaceResource(resource));
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
    viewModel: NamespaceResourceTableViewModel,
    template: template
};
