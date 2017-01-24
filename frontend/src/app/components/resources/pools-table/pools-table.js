import template from './pools-table.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import PoolRowViewModel from './pool-row';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import { navigateTo } from 'actions';
import { routeContext, systemInfo } from 'model';
import { inputThrottle } from 'config';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true
    },
    {
        name: 'name',
        label: 'pool name',
        type: 'link',
        sortable: true
    },
    {
        name: 'buckets',
        label: 'buckets using pool',
        sortable: true
    },
    {
        name: 'nodeCount',
        label: 'nodes',
        sortable: true
    },
    {
        name: 'onlineCount',
        label: 'online',
        sortable: true
    },
    {
        name: 'offlineCount',
        label: 'offline',
        sortable: true
    },
    {
        name: 'capacity',
        label: 'used capacity',
        sortable: true,
        type: 'capacity'
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

const poolsToBuckets = ko.pureComputed(
    () => {
        if (!systemInfo()) {
            return {};
        }

        return systemInfo().buckets.reduce(
            (mapping, bucket) => systemInfo().tiers
                .find(
                    tier => tier.name === bucket.tiering.tiers[0].tier
                )
                .attached_pools.reduce(
                    (mapping, pool) => {
                        mapping[pool] = mapping[pool] || [];
                        mapping[pool].push(bucket.name);
                        return mapping;
                    },
                    mapping
                ),
            {}
        );
    }
);

const compareAccessors = deepFreeze({
    state: pool => pool.nodes.online >= 3,
    name: pool => pool.name,
    buckets: pool => (poolsToBuckets()[pool.name] || []).length,
    nodeCount: pool => pool.nodes.count,
    onlineCount: pool => pool.nodes.online,
    offlineCount: pool => pool.nodes.count - pool.nodes.online,
    capacity: pool => pool.storage.used
});

class PoolsTableViewModel extends BaseViewModel {
    constructor() {
        super();

        this.isCreatePoolDisabled = ko.pureComputed(
            () => Boolean(systemInfo()) && systemInfo().nodes.count < 3
        );

        this.createPoolTooltip = ko.pureComputed(
            () => this.isCreatePoolDisabled() ?
                'In order to create a pool you must install at least 3 node' :
                ''
        );

        this.columns = columns;

        const query = ko.pureComputed(
            () => routeContext().query || {}
        );

        this.filter = ko.pureComputed({
            read: () => query().filter,
            write: throttle(phrase => this.filterPools(phrase), inputThrottle)
        });

        this.sorting = ko.pureComputed({
            read: () => {
                const { sortBy, order } = query();
                const canSort = Object.keys(compareAccessors).includes(sortBy);
                return {
                    sortBy: (canSort && sortBy) || 'name',
                    order: (canSort && Number(order)) || 1
                };
            },
            write: value => this.orderBy(value)
        });

        const allNodePools = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : []).filter(
                ({ nodes }) => Boolean(nodes)
            )
        );

        this.pools = ko.pureComputed(
            () => {
                const { sortBy, order } = this.sorting();
                const compareOp = createCompareFunc(compareAccessors[sortBy], order);
                const filter = (this.filter() || '').toLowerCase();

                return allNodePools()
                    .filter(
                        ({ name }) => name.toLowerCase().includes(filter)
                    )
                    .sort(compareOp);
            }
        );

        this.deleteGroup = ko.observable();
        this.isCreatePoolWizardVisible = ko.observable(false);
    }

    newPoolRow(pool) {
        return new PoolRowViewModel(pool, this.deleteGroup, poolsToBuckets);
    }

    orderBy({ sortBy, order }) {
        this.deleteGroup(null);

        const filter = this.filter() || undefined;
        navigateTo(undefined, undefined, { filter, sortBy, order });
    }

    filterPools(phrase) {
        this.deleteGroup(null);

        const filter = phrase || undefined;
        const { sortBy, order } = this.sorting() || {};
        navigateTo(undefined, undefined, { filter, sortBy, order });
    }

    showCreatePoolWizard() {
        this.isCreatePoolWizardVisible(true);
    }

    hideCreatePoolWizard() {
        this.isCreatePoolWizardVisible(false);
    }
}

export default {
    viewModel: PoolsTableViewModel,
    template: template
};
