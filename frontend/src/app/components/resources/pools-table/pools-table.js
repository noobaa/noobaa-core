import template from './pools-table.html';
import Disposable from 'disposable';
import ko from 'knockout';
import PoolRowViewModel from './pool-row';
import { deepFreeze, createCompareFunc } from 'utils';
import { redirectTo } from 'actions';
import { routeContext, systemInfo } from 'model';

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
        label: 'bucket using pool',
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
                .node_pools.reduce(
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

class PoolsTableViewModel extends Disposable {
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

        this.sorting = ko.pureComputed({
            read: () => {
                let { params, query } = routeContext();
                let isOnScreen = params.tab === 'pools';

                return {
                    sortBy: (isOnScreen && query.sortBy) || 'name',
                    order: (isOnScreen && Number(routeContext().query.order)) || 1
                };
            },
            write: value => {
                this.deleteGroup(null);
                redirectTo(undefined, undefined, value);
            }
        });

        this.pools = ko.pureComputed(
            () => {
                let { sortBy, order } = this.sorting();
                let compareOp = createCompareFunc(compareAccessors[sortBy], order);

                return systemInfo() && systemInfo().pools
                    .filter(
                        pool => pool.nodes
                    )
                    .slice(0)
                    .sort(compareOp);
            }
        );

        this.deleteGroup = ko.observable();
        this.isCreatePoolWizardVisible = ko.observable(false);
    }

    newPoolRow(pool) {
        return new PoolRowViewModel(pool, this.deleteGroup, poolsToBuckets);
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
