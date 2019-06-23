/* Copyright (C) 2016 NooBaa */

import template from './server-table.html';
import usageTooltip from './usage-tooltip.html';
import ConnectableViewModel from 'components/connectable';
import { createCompareFunc, deepFreeze, throttle } from 'utils/core-utils';
import { toBytes, formatSize } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { summarizeServerIssues, getServerDisplayName, getServerStateIcon } from 'utils/cluster-utils';
import { inputThrottle } from 'config';
import { openAttachServerModal, requestLocation } from 'action-creators';
import ko from 'knockout';
import numeral from 'numeral';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: server => server.mode
    },
    {
        name: 'name',
        label: 'server name',
        sortable: true,
        compareKey: server => getServerDisplayName(server)
    },
    {
        name: 'diskUsage',
        label: 'Disk',
        type: 'usage',
        sortable: true,
        compareKey: server => 1 - toBytes(server.storage.free) / toBytes(server.storage.total)
    },
    {
        name: 'memoryUsage',
        label: 'Memory',
        type: 'usage',
        sortable: true,
        compareKey: server => server.memory.used / server.memory.total
    },
    {
        name: 'cpuUsage',
        label: 'CPUs',
        type: 'usage',
        sortable: true,
        compareKey: server => server.cpus.usage
    },
    {
        name: 'version',
        sortable: true,
        compareKey: server => server.version
    }
]);

function _matchFilter(server, filter = '') {
    const { addresses, locationTag } = server;
    const { ip } = addresses.length > 0 ? addresses[0] : '';
    return [`${getServerDisplayName(server)}`, ip, locationTag].some(
        key => key.toLowerCase().includes(filter.toLowerCase())
    );
}

function _getStatus(server, version, serverMinRequirements) {
    const issues = Object.values(
        summarizeServerIssues(server, version, serverMinRequirements)
    );

    if (server.mode === 'CONNECTED' && issues.length) {
        return {
            name: 'problem',
            css: 'warning',
            tooltip: {
                template: 'list',
                text: issues,
                align: 'start',
                breakWords: false
            }
        };
    }

    return getServerStateIcon(server);
}

function _getDiskUsage(server) {
    if (server.mode === 'DISCONNECTED') {
        return {
            ratio: 0,
            percentage: '0%',
            tooltip: ''
        };

    } else {
        const total = toBytes(server.storage.total);
        const free = toBytes(server.storage.free);
        const used = total - free;
        const usedRatio = total ? used / total : 0;
        const tooltip = {
            template: usageTooltip,
            text: `${formatSize(used)} of ${formatSize(total)}`
        };

        // let css = '';
        // if (usedRatio >= diskUsageWarningBound) {
        //     css = usedRatio >= diskUsageErrorBound ? 'error' : 'warning';
        // }

        return {
            ratio: usedRatio,
            percentage: numeral(usedRatio).format('%'),
            tooltip
        };
    }
}

function _getMemoryUsage(server) {
    if (server.mode === 'DISCONNECTED') {
        return {
            ratio: 0,
            percentage: '0%',
            tooltip: ''
        };
    } else {
        const { total, used } = server.memory;
        const usedRatio = total ? used / total : total;
        return {
            ratio: usedRatio,
            percentage: numeral(usedRatio).format('%'),
            tooltip: {
                template: usageTooltip,
                text: `${formatSize(used)} of ${formatSize(total)}`
            }
        };
    }
}

function _getCpuUsage(server) {
    if (server.mode === 'DISCONNECTED') {
        return {
            ratio: 0,
            percentage: '0%',
            tooltip: ''
        };

    } else {
        const { usage, count } = server.cpus;
        return {
            ratio: usage,
            percentage: numeral(usage).format('%'),
            tooltip: {
                template: usageTooltip,
                text: `${numeral(count).format(',')} CPUs`
            }
        };
    }
}

class ServerRowViewModel {
    baseRoute = '';
    state = ko.observable();
    name = ko.observable();
    address = ko.observable();
    diskUsage = {
        ratio: ko.observable(),
        percentage: ko.observable(),
        tooltip: ko.observable()
    };
    memoryUsage = {
        ratio: ko.observable(),
        percentage: ko.observable(),
        tooltip: ko.observable()
    }
    cpuUsage = {
        ratio: ko.observable(),
        percentage: ko.observable(),
        tooltip: ko.observable()
    }
    version = ko.observable();
}

class ServerTableViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    pathname = '';
    columns = columns;
    filter = ko.observable();
    sorting = ko.observable();
    rows = ko.observableArray()
        .ofType(ServerRowViewModel, { table: this });

    canAttachServer = false;
    attachServerTooltip = {
        align: 'end',
        text: 'Attaching a server will be available in future versions'
    };

    onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

    selectState(state) {
        const { topology, system, location } = state;
        return [
            topology,
            system && system.version,
            location
        ];
    }

    mapStateToProps(topology, systemVersion, location) {
        if (!topology) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { query, pathname } = location;
            const { filter = '', sortBy = 'name' } = query;
            const order = Number(location.query.order) || 1;
            const { compareKey } = columns.find(column => column.name === sortBy);
            const serverList = Object.values(topology.servers);

            ko.assignToProps(this, {
                dataReady: true,
                pathname,
                filter,
                sorting: { sortBy, order },
                rows: serverList
                    .filter(server => _matchFilter(server, filter))
                    .sort(createCompareFunc(compareKey, order))
                    .map(server => {
                        return {
                            state: _getStatus(
                                server,
                                systemVersion,
                                topology.serverMinRequirements
                            ),
                            name: `${getServerDisplayName(server)} ${server.isMaster ? '(Master)' : ''}`,
                            diskUsage: _getDiskUsage(server),
                            memoryUsage: _getMemoryUsage(server),
                            cpuUsage: _getCpuUsage(server),
                            version: server.version
                        };
                    })
            });
        }
    }

    onFilter(filter) {
        this._query({ filter });
    }

    onSort(sorting) {
        this._query({ sorting });
    }

    _query(params) {
        const {
            filter = this.filter(),
            sorting = this.sorting()
        } = params;

        const { sortBy, order } = sorting;
        const query = {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order
        };

        this.dispatch(requestLocation(
            realizeUri(this.pathname, null, query)
        ));
    }

    onAttachServerToCluster() {
        this.dispatch(openAttachServerModal());
    }
}

export default {
    viewModel: ServerTableViewModel,
    template: template
};
