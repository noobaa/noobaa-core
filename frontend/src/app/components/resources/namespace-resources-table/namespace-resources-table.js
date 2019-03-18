/* Copyright (C) 2016 NooBaa */

import template from './namespace-resources-table.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, createCompareFunc, throttle } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { includesIgnoreCase, stringifyAmount } from 'utils/string-utils';
import { getNamespaceResourceStateIcon, getNamespaceResourceTypeIcon } from 'utils/resource-utils';
import { inputThrottle, paginationPageSize } from 'config';
import * as routes from 'routes';
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
        label: 'connected namespace buckets',
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

const undeletableReasonToTooltip = deepFreeze({
    IN_USE: 'Cannot delete a resource which is used by a namespace bucket'
});

function _mapResourceToRow(resource, connectedBuckets, system, selectedForDelete) {
    const { name, target, undeletable } = resource;
    const conenctedBucketsInfo = {
        text: stringifyAmount('bucket', connectedBuckets.length),
        tooltip: {
            template: 'linkList',
            text: connectedBuckets.length > 0 ?
                connectedBuckets.map(bucket => ({
                    text: bucket,
                    href: realizeUri(routes.namespaceBucket, { system, bucket })
                })) :
                null
        }
    };

    return {
        state: getNamespaceResourceStateIcon(resource),
        type: getNamespaceResourceTypeIcon(resource),
        name,
        connectedBuckets: conenctedBucketsInfo,
        target: {
            text: target,
            tooltip: target
        },
        deleteButton: {
            id: name,
            active: selectedForDelete == name,
            disabled: Boolean(undeletable),
            tooltip: undeletableReasonToTooltip[undeletable] || 'Delete Resource'
        }
    };
}

class ResourceRowViewModel {
    table = null;
    state = ko.observable();
    type = ko.observable();
    name = ko.observable();
    connectedBuckets = ko.observable();
    target = ko.observable();
    deleteButton = {
        text: 'Delete resource',
        id: ko.observable(),
        active: ko.observable(),
        disabled: ko.observable(),
        tooltip: ko.observable(),
        onToggle: id => this.table.onSelectForDelete(id),
        onDelete: id => this.table.onDeleteResource(id)
    };

    constructor({ table }) {
        this.table = table;
    }
}

class NamespaceResourceTableViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    pageSize = paginationPageSize;
    columns = columns;
    pathname = '';
    sorting = ko.observable();
    filter = ko.observable();
    page = ko.observable();
    selectedForDelete = '';
    resourceCount = ko.observable();
    rows = ko.observableArray()
        .ofType(ResourceRowViewModel, { table: this });

    selectState(state) {
        return [
            state.namespaceResources,
            state.namespaceBuckets,
            state.location
        ];
    }

    mapStateToProps(resources, buckets, location) {
        if (!resources || !buckets || location.params.tab !== 'namespace') {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { pathname, query, params } = location;
            const { filter, sortBy = 'name', selectedForDelete } = query;
            const page = Number(query.page) || 0;
            const order = Number(query.order) || 1;
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
                .filter(resource => includesIgnoreCase(resource.name, filter));

            const rows = filteredRows
                .sort(createCompareFunc(compareKey, order, connectedBucketsMap))
                .slice(pageStart, pageStart + this.pageSize)
                .map(resource => _mapResourceToRow(
                    resource,
                    connectedBucketsMap[resource.name] || [],
                    params.system,
                    selectedForDelete
                ));

            ko.assignToProps(this, {
                dataReady: true,
                pathname,
                filter,
                sorting: { sortBy, order },
                page,
                resourceCount: filteredRows.length,
                selectedForDelete,
                rows
            });

        }
    }

    onFilter = throttle(filter => {
        this._query({
            filter: filter,
            page: 0,
            selectedForDelete: null
        });
    }, inputThrottle)

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
        this.dispatch(openCreateNamespaceResourceModal());
    }

    onDeleteResource(resource) {
        this.dispatch(deleteNamespaceResource(resource));
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
    viewModel: NamespaceResourceTableViewModel,
    template: template
};
