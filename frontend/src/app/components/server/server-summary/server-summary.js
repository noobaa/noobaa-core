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

const statusLabels = deepFreeze({
    CONNECTED: 'Connected',
    DISCONNECTED: 'Disconnected',
    IN_PROGRESS: 'Server attaching to cluster'
});

const icons = deepFreeze({
    healthy: {
        name: 'healthy',
        css: 'success',
        tooltip: {
            text: 'No Issues',
            align: 'start'
        }
    },
    warning: {
        name: 'problem',
        css: 'warning'
    },
    unavailable: {
        name: 'problem',
        css: 'warning',
        tooltip: {
            text: 'Disconnected',
            align: 'start'
        }
    },
    in_progress: {
        name: 'working',
        css: 'warning',
        tooltip: {
            text: 'Server Attaching',
            align: 'start'
        }
    }
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
    switch (server.mode) {
        case 'DISCONNECTED':
            return {
                icon: icons.unavailable,
                text: 'Server services are unavailable'
            };
        case 'IN_PROGRESS':
            return {
                icon: icons.in_progress,
                text: 'Server status is unavailable'
            };
    }

    const issues = Object.values(
        summarizeServerIssues(server, version, serverMinRequirements)
    );

    switch (issues.length) {
        case 0:
            return {
                icon: icons.healthy,
                text: 'Server has no issues'
            };
        case 1:
            return {
                icon: {
                    ...icons.warning,
                    tooltip: {
                        text: 'Has issues',
                        align: 'start'
                    }
                },
                text: issues[0]
            };
        default:
            return {
                icon: {
                    ...icons.warning,
                    tooltip: {
                        text: issues,
                        align: 'start'
                    }
                },
                text: `Server has ${issues.length} issues`
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
    barValues = ko.observable();
    barOptions = ko.observable();
    isServerLoaded = ko.observable();

    constructor({ serverSecret }) {
        super();

        const secret = ko.unwrap(serverSecret);

        this.observe(
            state$.pipe(
                getMany(
                    ['topology', 'servers', secret],
                    ['topology', 'serverMinRequirements'],
                    'system'
                )
            ),
            this.onState
        );
    }

    onState([server, serverMinRequirements, system]) {
        if (!server || !serverMinRequirements || !system) {
            this.isServerLoaded(false);
            return;
        }

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
        this.barValues(_getBarValues(server));
        this.barOptions(barOptions);
        this.isServerLoaded(true);
    }
}

export default {
    viewModel: ServerSummaryViewModel,
    template: template
};
