/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { realizeUri } from 'utils/browser-utils';
import { formatSize } from 'utils/size-utils';
import { toBytes } from 'utils/size-utils';
import { summarizeServerIssues, getServerDisplayName, getServerStateIcon } from 'utils/cluster-utils';

const diskUsageErrorBound = .95;
const diskUsageWarningBound = .85;

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

export default class ServerRowViewModel extends BaseViewModel {
    baseRoute = '';
    state = ko.observable();
    name = ko.observable();
    address = ko.observable();
    diskUsage = ko.observable();
    memoryUsage = ko.observable();
    cpuUsage = ko.observable();
    version = ko.observable();
    location = ko.observable();

    constructor({ baseRoute }) {
        super();

        this.baseRoute = baseRoute;
    }

    onState(server, systemVersion, serverMinRequirements) {
        const { version, locationTag } = server;
        const [ address ] = server.addresses;
        const state = _getStatus(server, systemVersion, serverMinRequirements);
        const uri = realizeUri(this.baseRoute, { server: getServerDisplayName(server) });
        const diskUsage = _getDiskUsage(server);
        const memoryUsage = _getMemoryUsage(server);
        const cpuUsage = _getCpuUsage(server);
        const location = locationTag || 'not set';
        const serverName = {
            text: `${getServerDisplayName(server)} ${server.isMaster ? '(Master)' : ''}`,
            href: uri
        };

        this.state(state);
        this.name(serverName);
        this.address(address.ip);
        this.diskUsage(diskUsage);
        this.memoryUsage(memoryUsage);
        this.cpuUsage(cpuUsage);
        this.version(version);
        this.location(location);

    }
}
