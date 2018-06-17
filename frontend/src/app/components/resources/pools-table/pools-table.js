/* Copyright (C) 2016 NooBaa */

import template from './pools-table.html';
import Observer from 'observer';
import PoolRowViewModel from './pool-row';
import { state$, action$ } from 'state';
import { requestLocation, openCreatePoolModal, deleteResource } from 'action-creators';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze, throttle, createCompareFunc, groupBy, flatMap } from 'utils/core-utils';
import ko from 'knockout';
import { getMany } from 'rx-extensions';
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
        compareKey: (pool, bucketsByPool) =>
            (bucketsByPool[pool.name] || []).length
    },
    {
        name: 'hostCount',
        label: 'nodes',
        sortable: true,
        compareKey: pool => pool.hostCount
    },
    {
        name: 'healthyCount',
        label: 'healthy',
        sortable: true,
        compareKey: pool => pool.hostsByMode.OPTIMAL || 0
    },
    {
        name: 'issuesCount',
        label: 'issues',
        sortable: true,
        compareKey: pool => {
            const { hostCount, hostsByMode } = pool;
            const { OPTIMAL = 0, OFFLINE = 0 } = hostsByMode;
            return hostCount - (OPTIMAL + OFFLINE);
        }
    },
    {
        name: 'offlineCount',
        label: 'offline',
        sortable: true,
        compareKey: pool => pool.hostsByMode.OFFLINE || 0
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

const notEnoughHostsTooltip = deepFreeze({
    align: 'end',
    text: 'Not enough nodes to create a new pool, please install at least one node'
});

function _getBucketsByPool(buckets) {
    return Object.values(buckets).reduce((map, bucket) => {
        const resources = [
            ...flatMap(bucket.placement.mirrorSets, set => set.resources),
            bucket.spillover
        ];

        const hostPools = resources
            .filter(item => item && item.type === 'HOSTS')
            .map(item => item.name);

        for (const poolName of hostPools) {
            let list = map[poolName];
            if (!list) list = map[poolName] = [];
            list.push(bucket);
        }

        return map;
    }, {});
}

class PoolsTableViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.columns = columns;
        this.poolsLoaded = ko.observable();
        this.isCreatePoolDisabled = ko.observable();
        this.createPoolTooltip = ko.observable();
        this.filter = ko.observable();
        this.sorting = ko.observable();
        this.pageSize = paginationPageSize;
        this.page = ko.observable();
        this.poolCount = ko.observable();
        this.rows = ko.observableArray();
        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

        this.observe(
            state$.pipe(
                getMany(
                    'hostPools',
                    'accounts',
                    'buckets',
                    'location'
                )
            ),
            this.onState
        );
    }

    onState([ pools, accounts, buckets, location ]) {
        if (!pools || !accounts || !buckets) {
            this.poolsLoaded(false);
            this.isCreatePoolDisabled(true);
            return;
        }

        const { system, tab } = location.params;
        if (tab && tab !== 'pools') return;

        const { filter = '', sortBy = 'name', order = 1, page = 0, selectedForDelete } = location.query;
        const { compareKey } = columns.find(column => column.name === sortBy);
        const bucketsByPool = _getBucketsByPool(buckets);
        const compareOp = createCompareFunc(compareKey, order, bucketsByPool);
        const poolList = Object.values(pools);
        const hostCount = poolList.reduce((sum, pool) => sum + pool.hostCount, 0);
        const pageStart = Number(page) * this.pageSize;
        const rowParams = {
            baseRoute: realizeUri(routes.pool, { system }, {}, true),
            onSelectForDelete: this.onSelectForDelete.bind(this),
            onDelete: this.onDeletePool.bind(this)
        };

        const filteredRows = poolList
            .filter(pool => !filter || pool.name.includes(filter.toLowerCase()));

        const accountsByUsingResource = groupBy(
            Object.values(accounts),
            account => account.defaultResource,
            account => {
                const name = account.name;
                const href = realizeUri(routes.account, { system, account: name });
                return { name, href };
            }
        );

        const rows = filteredRows
            .sort(compareOp)
            .slice(pageStart, pageStart + this.pageSize)
            .map((pool, i) => {
                const usingAccounts = accountsByUsingResource[pool.name] || [];
                const row = this.rows.get(i) || new PoolRowViewModel(rowParams);
                row.onState(pool, bucketsByPool[pool.name] || [], usingAccounts, system, selectedForDelete);
                return row;
            });

        this.baseRoute = realizeUri(location.route, { system, tab }, {}, true);
        this.isCreatePoolDisabled(hostCount == 0);
        this.createPoolTooltip(hostCount > 0 ? '' : notEnoughHostsTooltip);
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.poolCount(filteredRows.length);
        this.rows(rows);
        this.poolsLoaded(true);
    }

    onFilter(filter) {
        const { sortBy, order } = this.sorting();
        const query = {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: 0,
            selectedForDelete: undefined
        };

        action$.next(requestLocation(
            realizeUri(this.baseRoute, {}, query)
        ));
    }

    onSort({ sortBy, order }) {
        const query = {
            filter: this.filter() || undefined,
            sortBy: sortBy,
            order: order,
            page: 0,
            selectedForDelete: undefined
        };

        action$.next(requestLocation(
            realizeUri(this.baseRoute, {}, query)
        ));
    }

    onPage(page) {
        const { sortBy, order } = this.sorting();
        const query = {
            filter: this.filter() || undefined,
            sortBy: sortBy,
            order: order,
            page: page,
            selectedForDelete: undefined
        };

        action$.next(requestLocation(
            realizeUri(this.baseRoute, {}, query)
        ));
    }

    onSelectForDelete(pool) {
        const { sortBy, order } = this.sorting();
        const query = {
            filter: this.filter() || undefined,
            sortBy: sortBy,
            order: order,
            page: this.page(),
            selectedForDelete: pool || undefined
        };

        action$.next(requestLocation(
            realizeUri(this.baseRoute, {}, query)
        ));
    }

    onCreatePool() {
        action$.next(openCreatePoolModal());
    }

    onDeletePool(poolName) {
        action$.next(deleteResource(poolName));
    }
}

export default {
    viewModel: PoolsTableViewModel,
    template: template
};

