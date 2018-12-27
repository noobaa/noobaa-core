/* Copyright (C) 2016 NooBaa */

import template from './server-table.html';
import ConnectableViewModel from 'components/connectable';
import { createCompareFunc, deepFreeze, throttle } from 'utils/core-utils';
import { toBytes, formatSize } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { summarizeServerIssues, getServerDisplayName, getServerStateIcon } from 'utils/cluster-utils';
import { inputThrottle } from 'config';
import * as routes from 'routes';
import { openAttachServerModal, requestLocation } from 'action-creators';
import ko from 'knockout';
import numeral from 'numeral';

const diskUsageErrorBound = .95;
const diskUsageWarningBound = .85;

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
        type: 'link',
        sortable: true,
        compareKey: server => getServerDisplayName(server)
    },
    {
        name: 'address',
        label: 'IP Address',
        sortable: true,
        compareKey: server => server.addresses[0].ip
    },
    {
        name: 'diskUsage',
        sortable: true,
        compareKey: server => 1 - toBytes(server.storage.free) / toBytes(server.storage.total)
    },
    {
        name: 'memoryUsage',
        sortable: true,
        compareKey: server => server.memory.used / server.memory.total
    },
    {
        name: 'cpuUsage',
        label: 'CPU usage',
        sortable: true,
        compareKey: server => server.cpus.usage
    },
    {
        name: 'location',
        label: 'Location Tag',
        sortable: true,
        compareKey: server => server.location
    },
    {
        name: 'version',
        sortable: true,
        compareKey: server => server.version
    }
]);

const noNtpTooltip = 'NTP must be configured before attaching a new server';
const notSupportedTooltip = 'Clustering capabilities in container environment will be available in the following versions of NooBaa.';

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
        return '---';
    } else {
        const total = toBytes(server.storage.total);
        const free = toBytes(server.storage.free);
        const used = total - free;
        const usedRatio = total ? used / total : 0;
        const text = numeral(usedRatio).format('0%');
        const tooltip = `Using ${formatSize(used)} out of ${formatSize(total)}`;

        let css = '';
        if (usedRatio >= diskUsageWarningBound) {
            css = usedRatio >= diskUsageErrorBound ? 'error' : 'warning';
        }

        return { text, tooltip, css };
    }
}

function _getMemoryUsage(server) {
    if (server.mode === 'DISCONNECTED') {
        return '---';
    } else {
        const { total, used } = server.memory;
        const usedRatio = total ? used / total : total;
        return {
            text: numeral(usedRatio).format('%'),
            tooltip: 'Avg. over the last minute'
        };
    }
}

function _getCpuUsage(server) {
    if (server.mode === 'DISCONNECTED') {
        return '---';
    } else {
        return {
            text: numeral(server.cpus.usage).format('%'),
            tooltip: 'Avg. over the last minute'
        };
    }
}

class ServerRowViewModel {
    baseRoute = '';
    state = ko.observable();
    name = ko.observable();
    address = ko.observable();
    diskUsage = ko.observable();
    memoryUsage = ko.observable();
    cpuUsage = ko.observable();
    version = ko.observable();
    location = ko.observable();
}

class ServerTableViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    pathname = '';
    columns = columns;
    canAttachServer = ko.observable();
    attachServerTooltip = ko.observable();
    filter = ko.observable();
    sorting = ko.observable();
    rows = ko.observableArray()
        .ofType(ServerRowViewModel, { table: this });

    onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

    selectState(state) {
        const { topology, system, location, platform } = state;
        return [
            topology,
            system && system.version,
            location,
            platform && platform.featureFlags.serverAttachment
        ];
    }

    mapStateToProps(topology, systemVersion, location, allowServerAttachment) {
        if (!topology) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { params, query, pathname } = location;
            const { filter = '', sortBy = 'name' } = query;
            const order = Number(location.query.order) || 1;
            const { compareKey } = columns.find(column => column.name === sortBy);
            const serverList = Object.values(topology.servers);
            const master = serverList.find(server => server.isMaster);

            ko.assignToProps(this, {
                dataReady: true,
                pathname,
                filter,
                sorting: { sortBy, order },
                canAttachServer: allowServerAttachment && Boolean(master.ntp),
                attachServerTooltip: {
                    align: 'end',
                    text: (
                        (!allowServerAttachment && notSupportedTooltip) ||
                        (!master.ntp && noNtpTooltip) ||
                        ''
                    )
                },
                rows: serverList
                    .filter(server => _matchFilter(server, filter))
                    .sort(createCompareFunc(compareKey, order))
                    .map(server => {
                        const { version, locationTag } = server;
                        const [ address = {} ] = server.addresses;

                        return {
                            state: _getStatus(
                                server,
                                systemVersion,
                                topology.serverMinRequirements
                            ),
                            name: {
                                text: `${getServerDisplayName(server)} ${server.isMaster ? '(Master)' : ''}`,
                                href: realizeUri(
                                    routes.server,
                                    { system: params.system, server: getServerDisplayName(server) }
                                )
                            },
                            address: address.ip || 'Not Available',
                            diskUsage: _getDiskUsage(server),
                            memoryUsage: _getMemoryUsage(server),
                            cpuUsage: _getCpuUsage(server),
                            version,
                            location: locationTag || 'not set'
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
