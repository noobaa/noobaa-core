/* Copyright (C) 2016 NooBaa */

import template from './server-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, makeArray } from 'utils/core-utils';
import { summarizeServerIssues } from 'utils/cluster-utils';
import style from 'style';
import numeral from 'numeral';
import {
    healthyIcon,
    errorIcon,
    warningIcon,
    processIcon
} from 'utils/icon-utils';

const statusMapping = deepFreeze({
    CONNECTED: {
        text: 'Connected',
        icon: healthyIcon()
    },

    DISCONNECTED: {
        text: 'Disconnected',
        icon: errorIcon()
    },

    IN_PROGRESS: {
        text: 'Server attaching to cluster',
        icon: processIcon()
    }
});

const notConnectedBars = deepFreeze({
    options: { background: style['color15'] },
    values: [
        {
            label: 'CPU: -',
            parts:[{ value: 0 }]
        },
        {
            label: 'Disk: -',
            parts:[{ value: 0 }]
        },
        {
            label: 'Memory: -',
            parts:[{ value: 0 }]
        }
    ]
});

function _getIssues(server, minRequirements, version) {
    if (server.mode !== 'CONNECTED') {
        return {
            icon: errorIcon({
                text: 'Disconnected',
                align: 'start'
            }),
            text: 'Server services are unavailable'
        };
    } else {
        const issues = Object.values(summarizeServerIssues(
            server,
            version,
            minRequirements
        ));

        if (issues.length === 0) {
            return {
                text: 'Server has no issues',
                icon: healthyIcon({
                    align: 'start',
                    text: 'No Issues'
                })
            };

        } else if (issues.length === 1) {
            return {
                text: issues[0],
                icon: warningIcon({
                    text: 'Has issues',
                    align: 'start'
                })
            };

        } else {
            return {
                text: `Server has ${issues.length} issues`,
                icon: warningIcon({
                    align: 'start',
                    text: issues
                })
            };
        }
    }
}

function _getBars(server) {
    if (server.mode !== 'CONNECTED') {
        return notConnectedBars;
    }

    const { cpus, storage, memory } = server;
    const diskUsage = 1 - (storage.free / storage.total);
    const memoryUsage = memory.used / memory.total;
    return {
        options: { background: true  },
        values: [
            {
                label: `CPU: ${numeral(cpus.usage).format('%')}`,
                parts:[{ value: cpus.usage / cpus.count }]
            },
            {
                label: `Disk: ${numeral(diskUsage).format('%')}`,
                parts:[{ value: diskUsage }]
            },
            {
                label: `Disk: ${numeral(memoryUsage).format('%')}`,
                parts:[{ value: memoryUsage }]
            }
        ]
    };
}

class ServerSummaryViewModel2 extends ConnectableViewModel {
    dataReady = ko.observable();
    isConnected = ko.observable();
    status = {
        text: ko.observable(),
        icon: {
            name: ko.observable(),
            css: ko.observable()
        }
    };
    issues = {
        text: ko.observable(),
        icon: {
            name: ko.observable(),
            css: ko.observable(),
            tooltip: ko.observable()
        }
    };
    bars = {
        options: {
            values: false,
            labels: true,
            underline: true,
            format: 'percentage',
            spacing: 50,
            scale: 1,
            background: ko.observable()
        },
        values: makeArray(3, () => ({
            label: ko.observable(),
            parts: [{
                color: style['color13'],
                value: ko.observable()
            }]
        }))
    };

    selectState(state, params) {
        const { topology = {}, system } = state;
        const { serverMinRequirements, servers } = topology;
        return [
            servers && servers[params.serverSecret],
            serverMinRequirements,
            system && system.version
        ];
    }

    mapStateToProps(server, minRequirements, systemVersion) {
        if (!server) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            ko.assignToProps(this, {
                dataReady: true,
                isConnected: server.mode === 'CONNECTED',
                status: statusMapping[server.mode],
                issues: _getIssues(server, minRequirements, systemVersion),
                bars: _getBars(server)
            });
        }
    }
}

export default {
    viewModel: ServerSummaryViewModel2,
    template: template
};
