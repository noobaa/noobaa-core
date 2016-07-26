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
        cellTemplate: 'icon',
        sortable: true
    },
    {
        name: 'name',
        label: 'pool name',
        cellTemplate: 'link',
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
        cellTemplate: 'capacity'
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        cellTemplate: 'delete'
    }

]);

const compareAccessors = deepFreeze({
    state: pool => pool.nodes.online >= 3,
    name: pool => pool.name,
    nodeCount: pool => pool.nodes.count,
    onlineCount: pool => pool.nodes.online,
    offlineCount: pool => pool.nodes.count - pool.nodes.online,
    capacity: pool => pool.storage.used
});

class PoolsTableViewModel extends Disposable {
    constructor() {
        super();

        this.columns = columns;

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: routeContext().query.sortBy || 'name',
                order: Number(routeContext().query.order) || 1
            }),
            write: value => redirectTo(undefined, undefined, value)
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
        return new PoolRowViewModel(pool, this.deleteGroup);
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
