/* Copyright (C) 2016 NooBaa */

import template from './namespace-resources-table.html';
import Observer from 'observer';
import ResourceRowViewModel from './resource-row';
import ko from 'knockout';
import { state$, action$ } from 'state';
import { deepFreeze, createCompareFunc, throttle } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
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
        compareKey: res => res.state
    },
    {
        name: 'type',
        type: 'icon',
        sortable: true,
        compareKey: res => res.type
    },
    {
        name: 'name',
        label: 'Resource name',
        sortable: true,
        compareKey: res => res.name
    },
    {
        name: 'connectedBuckets',
        label: 'Gateway Buckets Using Resource',
        sortable: true,
        compareKey: () => 1
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
        this.selectedForDelete = ko.observable();
        this.resourceCount = ko.observable();
        this.rows = ko.observableArray();
        this.resourcesLoaded = ko.observable();
        this.rowParams = {
            deleteGroup: ko.pureComputed({
                read: this.selectedForDelete,
                write: this.onSelectForDelete,
                owner: this
            }),
            onDelete: this.onDeleteResource.bind(this)
        };

        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

        this.observe(
            state$.getMany('namespaceResources', 'location'),
            this.onResources
        );
    }

    onResources([ resources, location ]) {
        if (!resources || location.params.tab !== 'namespace') {
            this.resourcesLoaded(Boolean(resources));
            return;
        }

        const { filter, sortBy = 'name', order = 1, page = 0, selectedForDelete } = location.query;
        const pageStart = Number(page) * this.pageSize;
        const { compareKey } = columns.find(column => column.name == sortBy);

        const filteredRows = Object.values(resources)
            .filter(resource => !filter || resource.name.includes(filter.toLowerCase()));

        const rows = filteredRows
            .sort(createCompareFunc(compareKey, order))
            .slice(pageStart, pageStart + this.pageSize)
            .map((resource, i) => {
                const row = this.rows()[i] || new ResourceRowViewModel(this.rowParams);
                row.onResource(resource, [] /* Connected Buckets */);
                return row;
            });

        this.pathname = location.pathname;
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.resourceCount(filteredRows.length);
        this.selectedForDelete(selectedForDelete);
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
        const selectedForDelete = this.selectedForDelete() === resource ? null : resource;
        this._query({ selectedForDelete });
    }

    onPage(page) {
        this._query({
            page: page,
            selectedForDelete: null
        });
    }

    onCreate() {
        action$.onNext(openCreateNamespaceResourceModal());
    }

    onDeleteResource(resource) {
        action$.onNext(deleteNamespaceResource(resource));
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
    viewModel: NamespaceResourceTableViewModel,
    template: template
};
