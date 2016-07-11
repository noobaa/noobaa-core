import template from './server-table.html';
import Disposable from 'disposable';
import ko from 'knockout';
import ServerRowViewModel from './server-row';
import { createCompareFunc, deepFreeze } from 'utils';
import { redirectTo } from 'actions';
import { systemInfo, routeContext } from 'model';

const columns = deepFreeze([
    {
        name: 'state',
        sortable: true
    },
    {
        name: 'hostname',
        sortable: true
    },
    {
        name: 'address',
        sortable: true
    },
    {
        name: 'memoryUsage',
        label: 'memroy usage',
        sortable: true
    },
    {
        name: 'cpuUsage',
        label: 'cpu usage',
        sortable: true
    },
    {
        name: 'version',
        sortable: true
    }
]);

const compareAccessors = deepFreeze({
    state: server => server.is_connected,
    hostname: server => server.hostname,
    address: server => server.address,
    memoryUsage: server => server.memory_usage,
    cpuUsage: server => server.cpu_usage,
    version: server => server.version
});

class ServerTableViewModel extends Disposable {
    constructor() {
        super();

        this.columns = columns;

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: routeContext().query.sortBy || 'hostname',
                order: Number(routeContext().query.order) || 1
            }),
            write: value => redirectTo(undefined, undefined, value)
        });

        this.servers = ko.pureComputed(
            () => {
                let { sortBy, order } = this.sorting();
                let compareOp = createCompareFunc(compareAccessors[sortBy], order);

                return systemInfo() && systemInfo().cluster.shards[0].servers
                    .slice(0)
                    .sort(compareOp);
            }
        );

        this.isAttachServerModalVisible = ko.observable(false);
    }

    rowFactory(server) {
        return new ServerRowViewModel(server);
    }

    showAttachServerModal() {
        this.isAttachServerModalVisible(true);
    }

    hideAttachServerModal() {
        this.isAttachServerModalVisible(false);
    }
}

export default {
    viewModel: ServerTableViewModel,
    template: template
};
