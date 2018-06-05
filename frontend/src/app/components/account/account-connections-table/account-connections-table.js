/* Copyright (C) 2016 NooBaa */

import template from './account-connections-table.html';
import Observer from 'observer';
import ConnectionRowViewModel from './connection-row';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { state$, action$ } from 'state';
import { inputThrottle, paginationPageSize } from 'config';
import ko from 'knockout';
import { getMany } from 'rx-extensions';
import {
    requestLocation,
    openAddCloudConnectionModal,
    deleteExternalConnection
} from 'action-creators';

const columns = deepFreeze([
    {
        name: 'service',
        type: 'icon',
        sortable: true,
        compareKey: connection => connection.service
    },
    {
        name: 'name',
        label: 'connection name',
        sortable: true,
        compareKey: connection => connection.name
    },
    {
        name: 'externalTargets',
        sortable: true,
        compareKey: connection => connection.usage.length
    },
    {
        name: 'endpoint',
        sortable: true,
        compareKey: connection => connection.endpoint
    },
    {
        name: 'identity',
        label: 'access key',
        sortable: true,
        compareKey: connection => connection.identity
    },
    {
        name: 'deleteButton',
        label: '',
        type: 'delete'
    }
]);

class AccountConnectionsTableViewModel extends Observer {
    constructor({ accountName }) {
        super();

        this.pathname = '';
        this.columns = columns;
        this.connectionsLoading = ko.observable();
        this.filter = ko.observable();
        this.sorting = ko.observable();
        this.pageSize = paginationPageSize;
        this.page = ko.observable();
        this.selectedForDelete = '';
        this.connectionCount = ko.observable();
        this.emptyMessage = ko.observable();
        this.rows = ko.observableArray();
        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

        this.observe(
            state$.pipe(
                getMany(
                    ['accounts', ko.unwrap(accountName), 'externalConnections'],
                    'buckets',
                    'namespaceBuckets',
                    'location'
                ),
            ),
            this.onConnections
        );
    }

    onConnections([connections, buckets, namespaceBuckets, location]) {
        if (!connections || !buckets || !namespaceBuckets) {
            this.connectionsLoading(true);
            return;
        }

        const { params, query, pathname } = location;
        const { tab = 'connections', system } = params;
        if (tab !== 'connections') return;

        const { filter, sortBy = 'name', order = 1, page = 0, selectedForDelete, expandedRow } = query;
        const { compareKey } = columns.find(column => column.name === sortBy);
        const pageStart = Number(page) * this.pageSize;
        const rowParams = {
            onSelectForDelete: this.onSelectForDelete.bind(this),
            onDelete: this.onDeleteConnection.bind(this),
            onExpand: this.onExpand.bind(this)
        };

        const filteredConnections = connections
            .filter(resource => !filter || resource.name.toLowerCase().includes(filter.toLowerCase()));

        const rows = filteredConnections
            .sort(createCompareFunc(compareKey, order))
            .slice(pageStart, pageStart + this.pageSize)
            .map((connection, i) => {
                const row = this.rows.get(i) || new ConnectionRowViewModel(rowParams);
                const isExpanded = expandedRow === connection.name;
                row.onConnection(connection, buckets, namespaceBuckets, system,
                    isExpanded, selectedForDelete);
                return row;
            });

        const emptyMessage = connections.length > 0 ?
            'The filter does not match and connection' :
            'The account has no external connections';

        this.pathname = pathname;
        this.expandedRow = expandedRow;
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.selectedForDelete = selectedForDelete;
        this.connectionCount(filteredConnections.length);
        this.emptyMessage(emptyMessage);
        this.rows(rows);
        this.connectionsLoading(false);
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

    onExpand(connection) {
        this._query({
            expandedRow: connection
        });
    }

    onPage(page) {
        this._query({
            page: page,
            expandedRow: null,
            selectedForDelete: null
        });
    }

    onSelectForDelete(resource) {
        this._query({ selectedForDelete: resource });
    }

    _query({
        filter = this.filter(),
        sorting = this.sorting(),
        page = this.page(),
        selectedForDelete = this.selectedForDelete,
        expandedRow = this.expandedRow
    }) {
        const query = {
            filter: filter || undefined,
            sortBy: sorting.sortBy,
            order: sorting.order,
            page,
            expandedRow: expandedRow || undefined,
            selectedForDelete: selectedForDelete || undefined
        };

        const url = realizeUri(this.pathname, {}, query);
        action$.next(requestLocation(url));
    }

    onAddConnection() {
        action$.next(openAddCloudConnectionModal());
    }

    onDeleteConnection(id) {
        const [name] = id.split(':');
        action$.next(deleteExternalConnection(name));
    }
}

export default {
    viewModel: AccountConnectionsTableViewModel,
    template: template
};
