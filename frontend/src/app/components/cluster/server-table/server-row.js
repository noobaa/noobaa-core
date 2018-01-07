/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import { getServerIssues } from 'utils/cluster-utils';

const diskUsageErrorBound = .95;
const diskUsageWarningBound = .85;
const stateIconMapping = deepFreeze({
    CONNECTED: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Connected'
    },

    IN_PROGRESS: {
        name: 'in-progress',
        css: 'warning',
        tooltip: 'in progress'
    },

    DISCONNECTED: {
        name: 'problem',
        css: 'error',
        tooltip: 'Disconnected'
    },

    WARNING: {
        name: 'problem',
        css: 'warning'
    }
});

export default class ServerRowViewModel extends BaseViewModel {
    constructor(server) {
        super();

        this.state = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';
                }

                const { status } = server();
                if (status === 'CONNECTED') {

                    const { version, cluster } = systemInfo();
                    const issues = Object.values(
                        getServerIssues(server(), version, cluster.min_requirements)
                    );
                    if (issues.length > 0) {
                        return Object.assign(
                            {
                                tooltip: {
                                    text: issues,
                                    align: 'start',
                                    breakWords: false
                                }
                            },
                            stateIconMapping['WARNING']
                        );
                    }
                }

                return stateIconMapping[status];
            }
        );

        this.name = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';
                }

                const { secret, hostname } = server();
                const name = `${hostname}-${secret}`;
                const masterSecret = systemInfo() && systemInfo().cluster.master_secret;

                const text = `${name} ${ secret === masterSecret ? '(Master)' : '' }`;
                const href = {
                    route: 'server',
                    params: { server: `${hostname}-${secret}`, tab: null }
                };

                return { text, href };
            }
        );

        this.address = ko.pureComputed(
            () => server() ? (server().addresses || [])[0] : ''
        );

        this.diskUsage = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';

                } else if (server().status === 'DISCONNECTED') {
                    return '---';

                } else {
                    const { free, total } = server().storage;
                    const used = total - free;
                    const usedRatio = used / total;
                    const text = numeral(usedRatio).format('0%');
                    const tooltip = `Using ${formatSize(used)} out of ${formatSize(total)}`;

                    let css = '';
                    if (usedRatio >= diskUsageWarningBound) {
                        css = usedRatio >= diskUsageErrorBound ? 'error' : 'warning';
                    }

                    return { text, tooltip, css };
                }
            }
        );

        this.memoryUsage = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';

                } else if (server().status === 'DISCONNECTED') {
                    return '---';

                } else {
                    const { total, used } = server().memory;
                    return {
                        text: numeral(used / total).format('%'),
                        tooltip: 'Avg. over the last minute'
                    };
                }
            }
        );

        this.cpuUsage = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';

                } else if (server().status === 'DISCONNECTED') {
                    return '---';

                } else {
                    return {
                        text: numeral(server().cpus.usage).format('%'),
                        tooltip: 'Avg. over the last minute'
                    };
                }
            }
        );

        this.version = ko.pureComputed(
            () => server() ? server().version : 'N/A'
        );

        this.location = ko.pureComputed(
            () => server() && server().location || 'not set'
        );
    }
}
