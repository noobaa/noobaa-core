/* Copyright (C) 2016 NooBaa */

import template from './server-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { summarizeServerIssues } from 'utils/cluster-utils';
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
    cpuUsage = ko.observable();
    diskUsage = ko.observable();
    memoryUsage = ko.observable()

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
            const { cpus, storage, memory } = server;
            const cpuUsage = cpus.usage / cpus.count;
            const diskUsage = 1 - (storage.free / storage.total);
            const memoryUsage = memory.used / memory.total;


            ko.assignToProps(this, {
                dataReady: true,
                firstRender: false,
                isConnected: server.mode === 'CONNECTED',
                status: statusMapping[server.mode],
                issues: _getIssues(server, minRequirements, systemVersion),
                cpuUsage,
                diskUsage,
                memoryUsage

            });
        }
    }
}

export default {
    viewModel: ServerSummaryViewModel2,
    template: template
};
