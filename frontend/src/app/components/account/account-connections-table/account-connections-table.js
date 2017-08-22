/* Copyright (C) 2016 NooBaa */

import template from './account-connections-table.html';
import Observer from 'observer';
import ConnectionRowViewModel from './connection-row';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { state$, action$ } from 'state';
import { paginationPageSize } from 'config';
import ko from 'knockout';
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
        this.selectedForDelete = ko.observable();
        this.rows = ko.observableArray();
        this.sorting = ko.observable();
        this.pageSize = paginationPageSize;
        this.page = ko.observable();
        this.connectionCount = ko.observable();
        this.deleteGroup = ko.pureComputed({
            read: this.selectedForDelete,
            write: val => this.onSelectForDelete(val)
        });

        this.observe(
            state$.getMany(
                ['accounts', ko.unwrap(accountName), 'externalConnections'],
                'location'
            ),
            this.onConnections
        );
    }

    onConnections([connections, location]) {
        if(!connections) {
            this.connectionsLoading(true);
            return;
        }
        const { params, query, pathname } = location;
        const { tab = 'connections' } = params;
        if (tab !== 'connections') return;

        const { sortBy = 'name', order = 1, page = 0, selectedForDelete } = query;
        const { compareKey } = columns.find(column => column.name === sortBy);
        const pageStart = Number(page) * this.pageSize;
        const rowParams = {
            deleteGroup: this.deleteGroup,
            onDelete: this.onDeleteConnection.bind(this)
        };

        const rows = Array.from(connections)
            .sort(createCompareFunc(compareKey, order))
            .slice(pageStart, pageStart + this.pageSize)
            .map((connection, i) => {
                const row = this.rows.get(i) || new ConnectionRowViewModel(rowParams);
                row.onConnection(connection);
                return row;
            });

        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.connectionCount(connections.length);
        this.pathname = pathname;
        this.selectedForDelete(selectedForDelete);
        this.rows(rows);
        this.connectionsLoading(false);
    }

    onSort({ sortBy, order }) {
        const query = {
            sortBy: sortBy,
            order: order,
            page: 0,
            selectedForDelete: undefined
        };

        action$.onNext(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onPage(page) {
        const { sortBy, order } = this.sorting();
        const query = {
            sortBy: sortBy,
            order: order,
            page: page,
            selectedForDelete: undefined
        };

        action$.onNext(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onSelectForDelete(connection) {
        const { sortBy, order } = this.sorting();
        const query = {
            sortBy: sortBy,
            order: order,
            page: this.page(),
            selectedForDelete: connection || undefined
        };

        action$.onNext(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onAddConnection() {
        action$.onNext(openAddCloudConnectionModal());
    }

    onDeleteConnection(name) {
        action$.onNext(deleteExternalConnection(name));
    }
}

export default {
    viewModel: AccountConnectionsTableViewModel,
    template: template
};
