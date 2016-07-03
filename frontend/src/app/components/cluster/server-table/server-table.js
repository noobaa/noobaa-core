import template from './server-table.html';
import ko from 'knockout';
import ServerRow from './server-row';
import { createCompareFunc } from 'utils';
import { redirectTo } from 'actions';
import { systemInfo, routeContext } from 'model';

const columns = [
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
];

const compareAccessors = Object.freeze({
    state: server => server.is_connected,
    hostname: server => server.hostname,
    address: server => server.address,
    memoryUsage: server => server.memory_usage,
    cpuUsage: server => server.cpu_usage,
    version: server => server.version
});

class ServerTableViewModel {
    constructor() {
        this.columns = columns;

        let query = ko.pureComputed(
            () => routeContext().query
        );

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: query().sortBy || 'hostname',
                order: Number(query().order) || 1
            }),
            write: value => redirectTo(undefined, undefined, value)
        });

        let servers = ko.pureComputed(
            () => {
                let { sortBy, order } = this.sorting();
                let compareOp = createCompareFunc(compareAccessors[sortBy], order);

                return systemInfo() && systemInfo().cluster.shards[0].servers
                    .slice(0)
                    .sort(compareOp);
            }
        );

        this.rows = ko.pureComputed(
            () => servers() && servers().map(
                server => new ServerRow(server)
            )
        );

        this.isAttachServerModalVisible = ko.observable(false);
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
