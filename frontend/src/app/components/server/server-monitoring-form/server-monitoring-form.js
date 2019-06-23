/* Copyright (C) 2016 NooBaa */

import template from './server-monitoring-form.html';
import ConnectableViewModel from 'components/connectable';
import { summarizeServerIssues } from 'utils/cluster-utils';
import { realizeUri } from 'utils/browser-utils';
import { timeTickInterval, timeLongFormat } from 'config';
import ko from 'knockout';
import moment from 'moment';
import * as routes from 'routes';

function _selectIcon(connected, configured, issue, healthyStatus) {
    if (!connected) {
        return {
            name: 'healthy',
            css: 'disabled',
            tooltip: null
        };
    }

    if (!configured) {
        return {
            name: 'healthy',
            css: 'disabled',
            tooltip: {
                align: 'start',
                text: 'Not configured'
            }
        };
    }

    if (issue) {
        return {
            name: 'problem',
            css: 'error',
            tooltip: {
                align: 'start',
                text: issue
            }
        };
    }

    return {
        name: 'healthy',
        css: 'success',
        tooltip: {
            align: 'start',
            text: healthyStatus
        }
    };
}

function _getVersion(server, issue) {
    const { mode, version: text } = server;

    return {
        icon: _selectIcon(mode === 'CONNECTED', true, issue, 'Synced with master'),
        text
    };
}

function _getServerTime(server) {
    const { mode, clockSkew, timezone } = server;
    const time = Date.now() + clockSkew;

    return {
        icon: _selectIcon(mode === 'CONNECTED', true, null, 'Working Properly'),
        time,
        timezone,
        clock: moment.tz(time, timezone).format(timeLongFormat)
    };

}

function _getPhonehome(server, issue) {
    const { mode, phonehome, clockSkew } = server;

    return {
        icon: _selectIcon(mode === 'CONNECTED', true, issue, 'Reachable and working'),
        lastStatusCheck: moment(phonehome.lastStatusCheck + clockSkew).fromNow()
    };
}

class ServerDetailsFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    managmentUrl = '';
    secret = '';
    isConnected = ko.observable();
    version = {
        icon: ko.observable({}),
        text: ko.observable()
    };
    serverTime = {
        icon: ko.observable({}),
        time: 0,
        timezone: '',
        clock: ko.observable()
    };
    phonehome = {
        icon: ko.observable({}),
        lastStatusCheck: ko.observable()
    };

    constructor(params, inject) {
        super(params, inject);

        this.ticker = setInterval(
            () => this.onTick(),
            timeTickInterval
        );
    }

    selectState(state, params) {
        const { topology = {}, system } = state;
        const { servers, serverMinRequirements } = topology;
        return [
            servers && servers[params.serverSecret],
            system,
            serverMinRequirements
        ];
    }

    mapStateToProps(server, system, minRequirements) {
        if (!server || !system) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const issues = summarizeServerIssues(server, system.version, minRequirements);
            const managmentUrl = realizeUri(routes.management, { system: system.name, tab: 'settings'}, {}, true);

            ko.assignToProps(this, {
                dataReady: true,
                managmentUrl,
                isConnected: server.mode === 'CONNECTED',
                secret: server.secret,
                version: _getVersion(server, issues.version),
                serverTime: _getServerTime(server),
                phonehome: _getPhonehome(server, issues.phonehome)
            });
        }
    }

    onTick() {
        if (!this.dataReady() || !this.isConnected()) {
            return;
        }

        const { time, timezone } = this.serverTime;
        const updatedTime = time + timeTickInterval;

        ko.assignToProps(this, {
            serverTime: {
                time: updatedTime,
                clock: moment.tz(updatedTime, timezone).format(timeLongFormat)
            }
        });
    }
}

export default {
    viewModel: ServerDetailsFormViewModel,
    template: template
};

