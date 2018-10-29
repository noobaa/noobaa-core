/* Copyright (C) 2016 NooBaa */

import template from './pools-table.html';
import deleteBtnTooltipTemplate  from './delete-button-tooltip.html';
import ConnectableViewModel from 'components/connectable';
import { requestLocation, openCreatePoolModal, deleteResource } from 'action-creators';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze, throttle, createCompareFunc, groupBy, flatMap } from 'utils/core-utils';
import { stringifyAmount, includesIgnoreCase } from 'utils/string-utils';
import { unassignedRegionText, getHostPoolStateIcon } from 'utils/resource-utils';
import { flatPlacementPolicy } from 'utils/bucket-utils';
import { summrizeHostModeCounters } from 'utils/host-utils';
import ko from 'knockout';
import * as routes from 'routes';
import { inputThrottle, paginationPageSize } from 'config';
import numeral from 'numeral';

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
        type: 'link',
        sortable: true,
        compareKey: pool => pool.name
    },
    {
        name: 'region',
        sortable: true,
        compareKey: pool => pool.region || ''
    },
    {
        name: 'buckets',
        label: 'connected buckets',
        sortable: true,
        compareKey: (pool, bucketsByPool) =>
            (bucketsByPool[pool.name] || []).length
    },
    {
        name: 'hosts',
        label: 'Total Nodes'
    },
    {
        name: 'endpoints',
        label: 'S3 endpoints',
        sortable: true,
        compareKey: pool => pool.endpointNodeCount
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

function _getBucketsByPool(buckets) {
    const placement = flatMap(
        Object.values(buckets),
        bucket => flatPlacementPolicy(bucket)
    );

    return groupBy(
        placement.filter(r => r.resource.type === 'HOSTS'),
        r => r.resource.name,
        r => r.bucket
    );
}

function _matchFilter(filter, pool) {
    const { name, region } = pool;
    return (
        includesIgnoreCase(name, filter) ||
        includesIgnoreCase(region, filter)
    );
}

function _mapPoolToRow(
    pool,
    connectedBuckets,
    selectedForDelete,
    system,
    lockingAccounts,
) {
    const {
        name,
        region = unassignedRegionText,
        storage,
        undeletable = '',
        storageNodeCount,
        endpointNodeCount,
        hostsByMode
    } = pool;

    const stateIcon = getHostPoolStateIcon(pool);
    const { all, healthy, hasIssues, offline } = summrizeHostModeCounters(hostsByMode);

    return {
        state: {
            ...stateIcon,
            tooltip: {
                text: stateIcon.tooltip,
                align: 'start'
            }
        },
        name: {
            text: name,
            href: realizeUri(routes.pool, { system, pool: name })
        },
        region: {
            text: region,
            tooltip: region
        },
        buckets: {
            text: connectedBuckets.length ? stringifyAmount('bucket',  connectedBuckets.length) : 'None',
            tooltip: connectedBuckets.length ? {
                template: 'linkList',
                text: connectedBuckets.map(name => ({
                    text: name,
                    href: realizeUri(routes.bucket, { system, bucket: name })
                }))
            } : ''
        },
        hosts: {
            text: `${
                numeral(all).format(',')
            } nodes / ${
                numeral(storageNodeCount).format(',')
            } drives`,
            tooltip: {
                template: 'propertySheet',
                text: [
                    {
                        label: 'Healthy Nodes',
                        value: numeral(healthy).format(',')
                    },
                    {
                        label: 'Nodes with issues',
                        value: numeral(hasIssues).format(',')
                    },
                    {
                        label: 'Offline nodes',
                        value: numeral(offline).format(',')
                    }
                ]
            }
        },
        endpoints: numeral(endpointNodeCount).format(','),
        capacity: {
            total: storage.total,
            used: [
                { value: storage.used },
                { value: storage.usedOther },
                { value: storage.reserved }
            ]
        },
        deleteButton: {
            id: name,
            disabled: Boolean(undeletable),
            active: selectedForDelete === name,
            tooltip: {
                text: {
                    reason: undeletable,
                    accounts: lockingAccounts
                }
            }
        }
    };
}

class RowViewModel {
    table = null;
    state = ko.observable();
    name = ko.observable();
    region = ko.observable();
    buckets = ko.observable();
    hosts = ko.observable();
    endpoints = ko.observable();
    capacity = {
        total: ko.observable(),
        used: [
            {
                label: 'Used (Noobaa)',
                value: ko.observable()
            },
            {
                label: 'Used (other)',
                value: ko.observable()
            },
            {
                label: 'Reserved',
                value: ko.observable()
            }
        ]
    };
    deleteButton = {
        text: 'Delete pool',
        id: ko.observable(),
        active: ko.observable(),
        disabled: ko.observable(),
        tooltip: {
            template: deleteBtnTooltipTemplate,
            text: ko.observable()
        },
        onToggle: this.onToggle.bind(this),
        onDelete: this.onDelete.bind(this)
    };

    constructor({ table }) {
        this.table = table;
    }

    onToggle(poolName) {
        this.table.onSelectForDelete(poolName);
    }

    onDelete(poolName) {
        this.table.onDeletePool(poolName);
    }
}

class PoolsTableViewModel extends ConnectableViewModel {
    columns = columns;
    pageSize = paginationPageSize;
    pathname = '';
    dataReady = ko.observable();
    isCreatePoolDisabled = ko.observable();
    createPoolTooltip = ko.observable();
    filter = ko.observable();
    sorting = ko.observable();
    page = ko.observable();
    poolCount = ko.observable();
    rows = ko.observableArray()
        .ofType(RowViewModel, { table: this })

    selectState(state) {
        return [
            state.hostPools,
            state.accounts,
            state.buckets,
            state.location
        ];
    }

    mapStateToProps(pools, accounts, buckets, location) {
        const { system, tab } = location.params;
        if (tab && tab !== 'pools') return;

        if (!pools || !accounts || !buckets) {
            ko.assignToProps(this, {
                dataReady: false,
                isCreatePoolDisabled: true
            });

        } else {
            const { filter = '', sortBy = 'name', selectedForDelete } = location.query;
            const order = Number(location.query.order || 1);
            const page = Number(location.query.page || 0);
            const poolList = Object.values(pools);
            const pageStart = page * paginationPageSize;
            const filteredPools = poolList.filter(pool => _matchFilter(filter, pool));
            const bucketsByPool = _getBucketsByPool(buckets);
            const accountsByUsingResource = groupBy(
                Object.values(accounts),
                account => account.defaultResource,
                account => {
                    const name = account.name;
                    const href = realizeUri(routes.account, { system, account: name });
                    return { name, href };
                }
            );
            const compareOp = createCompareFunc(
                columns.find(column => column.name === sortBy).compareKey,
                order,
                bucketsByPool
            );

            ko.assignToProps(this, {
                dataReady: true,
                pathname: location.pathname,
                filter: filter,
                sorting: { sortBy, order },
                page: page,
                poolCount: filteredPools.length,
                rows: filteredPools
                    .sort(compareOp)
                    .slice(pageStart, pageStart + paginationPageSize)
                    .map(pool => _mapPoolToRow(
                        pool,
                        bucketsByPool[pool.name] || [],
                        selectedForDelete,
                        system,
                        accountsByUsingResource[pool.name]
                    ))
            });
        }
    }

    onFilter = throttle(filter => {
        this._query({
            filter,
            page: 0,
            selectedForDelete: null
        });
    }, inputThrottle)

    onSort(sorting) {
        this._query({
            sortBy: sorting.sortBy,
            order: sorting.order,
            page: 0,
            selectedForDelete: null
        });
    }

    onPage(page) {
        this._query({
            page,
            selectedForDelete: null
        });
    }

    onSelectForDelete(poolName) {
        const selectedForDelete = poolName || '';
        this._query({ selectedForDelete });
    }

    onCreatePool() {
        this.dispatch(openCreatePoolModal());
    }

    onDeletePool(poolName) {
        this.dispatch(deleteResource(poolName));
    }

    _query(query) {
        const {
            filter = this.filter(),
            sortBy = this.sorting().sortBy,
            order = this.sorting().order,
            page = this.page(),
            selectedForDelete = this.selectedForDelete()
        } = query;

        const queryUrl = realizeUri(this.pathname, null, {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: page,
            selectedForDelete: selectedForDelete || undefined
        });

        this.dispatch(requestLocation(queryUrl));
    }
}

export default {
    viewModel: PoolsTableViewModel,
    template: template
};

