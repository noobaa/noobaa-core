/* Copyright (C) 2016 NooBaa */

import template from './server-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { summarizeServerIssues } from 'utils/cluster-utils';
import themes from 'themes';
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

const notConnectedUtilization = deepFreeze({
    cpuUsage: {
        label: 'CPU: -',
        value: 0,
        complement: 1
    },
    diskUsage: {
        label: 'Disk: -',
        value: 0,
        complement: 1
    },
    memoryUsage: {
        label: 'Memory: -',
        value: 0,
        complement: 1
    }
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

function _getChartData(server, theme) {
    if (server.mode !== 'CONNECTED') {
        return notConnectedUtilization;
    }

    const { cpus, storage, memory } = server;
    const diskUsage = 1 - (storage.free / storage.total);
    const memoryUsage = memory.used / memory.total;
    // const cpuUsage = cpus.usage / cpus.count;
    const cpuUsage = Math.random();

    return {
        labels: [
            `CPU: ${numeral(cpus.usage).format('%')}`,
            `Disk: ${numeral(diskUsage).format('%')}`,
            `Memory: ${numeral(memoryUsage).format('%')}`
        ],
        datasets: [
            {
                backgroundColor: theme.color6,
                hoverBackgroundColor: theme.color6,
                data: [
                    cpuUsage,
                    diskUsage,
                    memoryUsage
                ]
            },
            {
                // Simulate a background using a stacked complement bar.
                backgroundColor: theme.color18,
                hoverBackgroundColor: theme.color18,
                data: [
                    1 - cpuUsage,
                    1 - diskUsage,
                    1 - memoryUsage
                ]
            }
        ]
    };
}

class ServerSummaryViewModel2 extends ConnectableViewModel {
    dataReady = ko.observable();
    isConnected = ko.observable();
    firstRender = true;
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
    chart = {
        options: {
            // Disable animation because we cannot lock the background dataset
            // from also animating.
            animation: false,
            maintainAspectRatio: false,
            scales: {
                xAxes: [{
                    stacked: true,
                    categoryPercentage: .8,
                    barPercentage: .5
                }],
                yAxes: [{
                    stacked: true,
                    gridLines: {
                        color: 'transparent',
                        drawTicks: false
                    },
                    ticks: {
                        callback: () => ''
                    }
                }]
            },
            tooltips: {
                enabled: false
            }
        },
        data: {
            labels: ko.observableArray(),
            datasets: [
                {
                    backgroundColor: ko.observable(),
                    hoverBackgroundColor: ko.observable(),
                    data: ko.observableArray()
                },
                {
                    // Simulate a background using a stacked complement bar.
                    backgroundColor: ko.observable(),
                    hoverBackgroundColor: ko.observable(),
                    data: ko.observableArray()
                }
            ]
        }
    }

    selectState(state, params) {
        const { topology = {}, system, session } = state;
        const { serverMinRequirements, servers } = topology;
        return [
            servers && servers[params.serverSecret],
            serverMinRequirements,
            system && system.version,
            themes[session.uiTheme]
        ];
    }

    mapStateToProps(server, minRequirements, systemVersion, theme) {
        if (!server) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            ko.assignToProps(this, {
                dataReady: true,
                firstRender: false,
                isConnected: server.mode === 'CONNECTED',
                status: statusMapping[server.mode],
                issues: _getIssues(server, minRequirements, systemVersion),
                chart: {
                    data: _getChartData(server, theme)
                }
            });
        }
    }
}

export default {
    viewModel: ServerSummaryViewModel2,
    template: template
};
