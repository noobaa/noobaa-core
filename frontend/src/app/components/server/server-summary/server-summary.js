/* Copyright (C) 2016 NooBaa */

import template from './server-summary.html';
import BaseViewModel from 'components/base-view-model';
import { systemInfo } from 'model';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getServerIssues } from 'utils/cluster-utils';
import style from 'style';
import numeral from 'numeral';

const icons = deepFreeze({
    healthy: {
        name: 'healthy',
        css: 'success'
    },
    problem: {
        name: 'problem',
        css: 'error'
    },
    in_progress: {
        name: 'working',
        css: 'warning'
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

const statusMapping = deepFreeze({
    CONNECTED: {
        text: 'Connected',
        icon: icons.healthy
    },

    DISCONNECTED: {
        text: 'Disconnected',
        icon: icons.problem
    },

    IN_PROGRESS: {
        text: 'Server attaching to cluster',
        icon: icons.in_progress
    }
});

const barOptions = deepFreeze({
    values: false,
    labels: true,
    underline: true,
    format: 'percentage',
    spacing: 50,
    scale: 1
});

class ServerSummaryViewModel extends BaseViewModel {
    constructor({ serverSecret }) {
        super();

        this.server = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0].servers.find(
                ({ secret }) => secret === ko.unwrap(serverSecret)
            )
        );

        this.isConnected = ko.pureComputed(
            () => this.server() && this.server().status === 'CONNECTED'
        );

        this.statusIcon = ko.pureComputed(
            () => this.server() ? statusMapping[this.server().status].icon : ''
        );


        this.statusText = ko.pureComputed(
            () => this.server() ? statusMapping[this.server().status].text : ''
        );

        const issues = ko.pureComputed(
            () => {
                if (!systemInfo() || !this.isConnected()) {
                    return {
                        icon: icons.unavailable,
                        text: 'Server services is unavailable',
                        tooltip: {
                            text: 'Disconnected',
                            align: 'start'
                        }
                    };
                }

                const { version, cluster } = systemInfo();
                const issues = Object.values(
                    getServerIssues(this.server(), version, cluster.min_requirements)
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
                            align: 'start',
                            text: issues
                        }
                    };

                } else {
                    return {
                        icon: icons.healthy,
                        text: 'Server has no issues',
                        tooltip: {
                            align: 'start',
                            text: 'No Issues'
                        }
                    };
                }
            }
        );

        this.issuesText = ko.pureComputed(
            () => issues().text
        );

        this.issuesIcon = ko.pureComputed(
            () => issues().icon
        );

        this.issuesTooltip = ko.pureComputed(
            () => issues().tooltip
        );

        this.barValues = this.getBarValues();
        this.barOptions = ko.pureComputed(
            () => Object.assign(
                { background: this.isConnected() ? true : style['color15'] },
                barOptions
            )
        );
    }

    getBarValues() {
        const cpus = ko.pureComputed(
            () => this.isConnected() ? this.server().cpus : {}
        );

        const diskUsage = ko.pureComputed(
            () => {
                if (!this.isConnected() ) {
                    return 0;
                }

                const { free, total } = this.server().storage;
                return (total - free) / total;
            }
        );

        const memoryUsage = ko.pureComputed(
            () => {
                if (!this.isConnected()){
                    return 0;
                }

                const { total, used } = this.server().memory;
                return used / total;
            }
        );

        return [
            {
                label: ko.pureComputed(
                    () => `CPU: ${
                        this.isConnected() ? numeral(cpus().usage).format('%') : '-'
                    }`
                ),
                parts: [
                    {
                        value: ko.pureComputed(
                            () => cpus().count ? cpus().usage / cpus().count : 0
                        ),
                        color: style['color13']
                    }
                ]
            },
            {
                label: ko.pureComputed(
                    () => `Disk: ${
                        this.isConnected() ? numeral(diskUsage()).format('%') : '-'
                    }`
                ),
                parts: [
                    {
                        value: diskUsage,
                        color: style['color13']
                    }
                ]
            },
            {
                label: ko.pureComputed(
                    () => `Memory: ${
                        this.isConnected() ? numeral(memoryUsage()).format('%') : '-'
                    }`
                ),
                parts: [
                    {
                        value: memoryUsage,
                        color: style['color13']
                    }
                ]
            }
        ];
    }
}

export default {
    viewModel: ServerSummaryViewModel,
    template: template
};
