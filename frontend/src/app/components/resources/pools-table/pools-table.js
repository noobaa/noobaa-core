/* Copyright (C) 2016 NooBaa */

import template from './pools-table.html';
import Observer from 'observer';
import PoolRowViewModel from './pool-row';
import { state$, action$ } from 'state';
import { requestLocation, openCreatePoolModal, deleteResource } from 'action-creators';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import ko from 'knockout';
import * as routes from 'routes';
import { inputThrottle, paginationPageSize } from 'config';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: pool => pool.mode
    },
    {
        name: 'name',
        label: 'pool name',
        type: 'newLink',
        sortable: true,
        compareKey: pool => pool.name
    },
    {
        name: 'buckets',
        label: 'buckets using resource',
        sortable: true,
        compareKey: () => 1
    },
    {
        name: 'hostCount',
        label: 'nodes',
        sortable: true,
        compareKey: () => 1
    },
    {
        name: 'healthyCount',
        label: 'healthy',
        sortable: true,
        compareKey: () => 1
    },
    {
        name: 'issuesCount',
        label: 'issues',
        sortable: true,
        compareKey: () => 1
    },
    {
        name: 'offlineCount',
        label: 'offline',
        sortable: true,
        compareKey: () => 1
    },
    {
        name: 'capacity',
        label: 'used capacity',
        type: 'capacity',
        sortable: true,
        compareKey: pool => pool.storage.used

    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

const notEnoughHostsTooltip = 'Not enough nodes to create a new pool, please install at least 3 nodes';

class PoolsTableViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.columns = columns;
        this.poolsLoaded = ko.observable(false);
        this.isCreatePoolDisabled = ko.observable();
        this.createPoolTooltip = ko.observable();
        this.filter = ko.observable();
        this.sorting = ko.observable();
        this.pageSize = paginationPageSize;
        this.page = ko.observable();
        this.poolCount = ko.observable();
        this.rows = ko.observableArray();
        this.deleteGroup = ko.observable();
        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

        this.observe(
            state$.getMany('hostPools', 'location'),
            this.onPools
        );
    }

    onPools([ pools, location ]) {
        const { system, tab } = location.params;
        if ((tab && tab !== 'pools') || !pools.items) return;

        const { filter = '', sortBy = 'name', order = 1, page = 0 } = location.query;
        const { compareKey } = columns.find(column => column.name === sortBy);

        const poolList = Object.values(pools.items);
        const hostCount = poolList.reduce((sum, pool) => sum + pool.hostCount, 0);
        const compareOp = createCompareFunc(compareKey, order);
        const pageStart = Number(page) * this.pageSize;
        const rowParams = {
            baseRoute: realizeUri(routes.pool, { system }, {}, true),
            onDelete: this.onDeletePool
        };

        const rows = poolList
            .filter(pool => !filter || pool.name.includes(filter.toLowerCase()))
            .sort(compareOp)
            .slice(pageStart, pageStart + this.pageSize)
            .map((pool, i) => {
                const row = this.rows.get(i) || new PoolRowViewModel(rowParams);
                row.onPool(pool);
                return row;
            });

        this.baseRoute = realizeUri(location.route, { system, tab }, {}, true);
        this.isCreatePoolDisabled(hostCount <= 3);
        this.createPoolTooltip(hostCount > 3 ? '' : notEnoughHostsTooltip);
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.poolCount(poolList.length);
        this.rows(rows);
        this.poolsLoaded(true);
    }

    onFilter(filter) {
        const { sortBy, order } = this.sorting();
        const query = {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: 0
        };

        action$.onNext(requestLocation(
            realizeUri(this.baseRoute, {}, query)
        ));
    }

    onSort({ sortBy, order }) {
        const query = {
            filter: this.filter() || undefined,
            sortBy: sortBy,
            order: order,
            page: 0
        };

        action$.onNext(requestLocation(
            realizeUri(this.baseRoute, {}, query)
        ));
    }

    onPage(page) {
        const { sortBy, order } = this.sorting();
        const query = {
            filter: this.filter() || undefined,
            sortBy: sortBy,
            order: order,
            page: page
        };

        action$.onNext(requestLocation(
            realizeUri(this.baseRoute, {}, query)
        ));
    }

    onCreatePool() {
        action$.onNext(openCreatePoolModal());
    }

    onDeletePool(poolName) {
        action$.onNext(deleteResource(poolName));
    }
}

export default {
    viewModel: PoolsTableViewModel,
    template: template
};

