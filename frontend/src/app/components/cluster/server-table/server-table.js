/* Copyright (C) 2016 NooBaa */

import template from './server-table.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import ServerRowViewModel from './server-row';
import { createCompareFunc, deepFreeze, throttle, flatMap } from 'utils/core-utils';
import { inputThrottle } from 'config';
import { navigateTo } from 'actions';
import { systemInfo, routeContext } from 'model';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true
    },
    {
        name: 'name',
        label: 'server name',
        type: 'link',
        sortable: true
    },
    {
        name: 'address',
        label: 'IP Address',
        sortable: true
    },
    {
        name: 'diskUsage',
        sortable: true
    },
    {
        name: 'memoryUsage',
        sortable: true
    },
    {
        name: 'cpuUsage',
        label: 'CPU usage',
        sortable: true
    },
    {
        name: 'location',
        label: 'Location Tag',
        sortable: true
    },
    {
        name: 'version',
        sortable: true
    }
]);

const noNtpTooltip = deepFreeze({
    align: 'end',
    text: 'NTP must be configured before attaching a new server'
});

const compareAccessors = deepFreeze({
    state: server => server.status,
    name: server => `${server.hostname}-${server.secret}`,
    address: server => (server.addresses || [])[0],
    diskUsage: server => 1 - server.storage.free / server.storage.total,
    memoryUsage: server => server.memory.used / server.memory.total,
    cpuUsage: server => server.cpus.usage,
    location: server => server.location,
    version: server => server.version
});

function matchFilter(server, filter = '') {
    const { hostname, secret, address, location } = server;
    return [`${hostname}-${secret}`, address, location].some(
        key => key.toLowerCase().includes(filter.toLowerCase())
    );
}

class ServerTableViewModel extends BaseViewModel {
    constructor() {
        super();

        this.columns = columns;

        this.canAttachServer = ko.pureComputed(
            () => {
                if (!systemInfo()) return false;

                const { shards, master_secret } = systemInfo().cluster;
                const { ntp_server } = flatMap(shards, shard => shard.servers)
                    .find(server => server.secret === master_secret);

                return Boolean(ntp_server);
            }
        );

        this.attachServerTooltip = ko.pureComputed(
            () => !this.canAttachServer() ? noNtpTooltip : ''
        );

        const query = ko.pureComputed(
            () => routeContext().query || {}
        );

        this.filter = ko.pureComputed({
            read: () => query().filter,
            write: throttle(phrase => this.filterServers(phrase), inputThrottle)
        });

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: routeContext().query.sortBy || 'name',
                order: Number(routeContext().query.order) || 1
            }),
            write: value => this.orderBy(value)
        });

        this.servers = ko.pureComputed(
            () => {
                const { sortBy, order } = this.sorting();
                const compareOp = createCompareFunc(compareAccessors[sortBy], order);

                return systemInfo() && systemInfo().cluster.shards[0].servers
                    .filter(server => matchFilter(server, this.filter()))
                    .sort(compareOp);
            }
        );

        this.actionContext = ko.observable();
        this.isAttachServerModalVisible = ko.observable(false);
        this.isServerDNSSettingsModalVisible = ko.observable(false);
        this.isServerTimeSettingsModalVisible = ko.observable(false);
    }

    rowFactory(server) {
        return new ServerRowViewModel(server);
    }

    filterServers(phrase) {
        const params = Object.assign(
            { filter: phrase || undefined },
            this.sorting()
        );

        navigateTo(undefined, undefined, params);
    }

    orderBy({ sortBy, order }) {
        const filter = this.filter() || undefined;
        navigateTo(undefined, undefined, { filter, sortBy, order });
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
