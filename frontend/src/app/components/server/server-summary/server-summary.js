/* Copyright (C) 2016 NooBaa */

import template from './server-summary.html';
import Observer from 'observer';
import ko from 'knockout';
import { getMany } from 'rx-extensions';
import { toBytes } from 'utils/size-utils';
import { deepFreeze } from 'utils/core-utils';
import { summarizeServerIssues, getServerStateIcon } from 'utils/cluster-utils';
import { state$ } from 'state';
import style from 'style';
import numeral from 'numeral';

const icons = deepFreeze({
    healthy: {
        name: 'healthy',
        css: 'success'
    },
    warning: {
        name: 'problem',
        css: 'warning'
    },
    unavailable: {
        name: 'healthy',
        css: 'disabled'
    }
});

const statusLabels = deepFreeze({
    CONNECTED: 'Connected',
    DISCONNECTED: 'Disconnected',
    IN_PROGRESS: 'Server attaching to cluster'
});

const barChartOptions = deepFreeze({
    values: false,
    labels: true,
    underline: true,
    format: 'percentage',
    spacing: 50,
    scale: 1
});

function _getIssues(server, version, serverMinRequirements) {
    if (server.mode !== 'CONNECTED') {
        return {
            icon: icons.unavailable,
            text: 'Server services is unavailable',
            tooltip: {
                text: 'Disconnected',
                align: 'start'
            }
        };
    }

    const issues = Object.values(
        summarizeServerIssues(server, version, serverMinRequirements)
    );

    if (issues.length === 1) {
        return {
            icon: icons.warning,
            text: issues[0],
            tooltip: {
                text: 'Has issues',
                align: 'start'
            }
        };

    } else if (issues.length > 1) {
        return {
            icon: icons.warning,
            text: `Server has ${issues.length} issues`,
            tooltip: {
                text: issues,
                align: 'start'
            }
        };

    } else {
        return {
            icon: icons.healthy,
            text: 'Server has no issues',
            tooltip: {
                text: 'No Issues',
                align: 'start'
            }
        };
    }
}

function _getBarValues(server) {
    const { cpus, storage, memory, mode } = server;
    const isConnected = mode === 'CONNECTED';
    const memoryUsage = isConnected ? memory.used / memory.total : 0;
    const free = toBytes(storage.free);
    const total = toBytes(storage.total);
    const diskUsage = isConnected ?
        ((total - free) / total) :
        0;

    return [
        {
            label: `CPU: ${isConnected ? numeral(cpus.usage).format('%') : '-'}`,
            parts: [
                {
                    value: cpus.count ? cpus.usage / cpus.count : 0,
                    color: style['color13']
                }
            ]
        },
        {
            label: `Disk: ${isConnected ? numeral(diskUsage).format('%') : '-'}`,
            parts: [
                {
                    value: diskUsage,
                    color: style['color13']
                }
            ]
        },
        {
            label: `Memory: ${isConnected ? numeral(memoryUsage).format('%') : '-'}`,
            parts: [
                {
                    value: memoryUsage,
                    color: style['color13']
                }
            ]
        }
    ];
}

class ServerSummaryViewModel extends Observer {
    statusText = ko.observable();
    statusIcon = ko.observable();
    issuesText = ko.observable();
    issuesIcon = ko.observable();
    issuesTooltip = ko.observable();
    barValues = ko.observable();
    barOptions = ko.observable();
    isConnected = ko.observable();
    isServerLoaded = ko.observable();

    constructor({ serverSecret }) {
        super();

        this.secret = ko.unwrap(serverSecret);

        this.observe(
            state$.pipe(
                getMany(
                    'topology',
                    'system'
                )
            ),
            this.onState
        );
    }

    onState([topology, system]) {
        if (!topology || !system) {
            this.isServerLoaded(false);
            return;
        }

        const { serverMinRequirements } = topology;
        const server = topology.servers[this.secret];
        const isConnected = server.mode === 'CONNECTED';

        const issues =_getIssues(server, system.version, serverMinRequirements);
        const barOptions = Object.assign(
            { background: isConnected ? true : style['color15'] },
            barChartOptions
        );

        this.statusText(statusLabels[server.mode]);
        this.statusIcon(getServerStateIcon(server));
        this.issuesText(issues.text);
        this.issuesIcon(issues.icon);
        this.issuesTooltip(issues.tooltip);
        this.barValues(_getBarValues(server));
        this.barOptions(barOptions);
        this.isConnected(isConnected);
        this.isServerLoaded(true);
    }
}

export default {
    viewModel: ServerSummaryViewModel,
    template: template
};
