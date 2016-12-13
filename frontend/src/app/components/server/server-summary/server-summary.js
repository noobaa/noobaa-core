import template from './server-summary.html';
import Disposable from 'disposable';
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
        name: 'notif-warning',
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
    underline: false,
    background: true,
    format: 'percentage',
    spacing: 50,
    scale: 1
});

class ServerSummaryViewModel extends Disposable{
    constructor({ serverSecret }) {
        super();

        const server = ko.pureComputed(
            // () => systemInfo() && systemInfo().cluster.shards[0].servers.find(
            //     ({ secret }) => secret === ko.unwrap(serverSecret)
            // )
            () => ({
                status: 'DISCONNECTED',
                version: '0.5.4',
                debug_level: true,
                cpus: {
                    usage: 1.4,
                    count: 3
                },
                memory_usage: .4,
                storage: {
                    free: 1000,
                    total: 50034
                },
                services_status: {
                    dns_servers: 'BLAAA'
                }
            })
        );

        this.notConnected = ko.pureComputed(
            () => !server() || server().status !== 'CONNECTED'
        );

        this.statusIcon = ko.pureComputed(
            () => server() ? statusMapping[server().status].icon : ''
        );


        this.statusText = ko.pureComputed(
            () => server() ? statusMapping[server().status].text : ''
        );

        const issues = ko.pureComputed(
            () => {
                if (!systemInfo() || this.notConnected()) {
                    return {
                        icon: icons.unavailable,
                        text: 'Server services is unavailable'
                    };
                }

                const issues = getServerIssues(server(), systemInfo());
                if (issues.length === 1) {
                    return {
                        icon: icons.warning,
                        text: issues[0]
                    };

                } else if (issues.length > 1) {
                    return {
                        icon: icons.warning,
                        text: `Server has ${issues.length} issues`
                    };

                } else {
                    return {
                        icon: icons.healthy,
                        text: 'Server has no issues'
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

        this.barValues = this.getBarValues(server);
        this.barOptions = barOptions;
    }

    getBarValues(server) {
        const cpus = ko.pureComputed(
            () => server() ? server().cpus : {}
        );

        const diskUsage = ko.pureComputed(
            () => {
                if (!server()) {
                    return 0;
                }

                const { free, total } = server().storage;
                return (total - free) / total;
            }
        );

        const memoryUsage = ko.pureComputed(
            () => server() ? server().memory_usage : 0
        );

        return [
            {
                label: ko.pureComputed(
                    () => `CPU: ${numeral(cpus().usage).format('%')}`
                ),
                value: ko.pureComputed(
                    () => cpus().usage / cpus().count
                ),
                color: style['color13']
            },
            {
                label: ko.pureComputed(
                    () => `Disk: ${numeral(diskUsage()).format('%')}`
                ),
                value: diskUsage,
                color: style['color13']
            },
            {
                label: ko.pureComputed(
                    () => `Memory: ${numeral(memoryUsage()).format('%')}`
                ),
                value: memoryUsage,
                color: style['color13']
            }
        ];
    }
}

export default {
    viewModel: ServerSummaryViewModel,
    template: template
};
