/* Copyright (C) 2016 NooBaa */

import template from './server-monitoring-form.html';
import ConnectableViewModel from 'components/connectable';
import { summarizeServerIssues } from 'utils/cluster-utils';
import { realizeUri } from 'utils/browser-utils';
import { timeTickInterval, timeLongFormat } from 'config';
import ko from 'knockout';
import moment from 'moment';
import * as routes from 'routes';
import {
    openEditServerDNSSettingsModal,
    openEditServerTimeSettingsModal,
    requestLocation
} from 'action-creators';

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

function _getServerTime(server, issue) {
    const { mode, clockSkew, timezone, ntp: ntpInfo } = server;
    const time = Date.now() + clockSkew;

    return {
        icon: _selectIcon(mode === 'CONNECTED', true, issue, 'Working Properly'),
        time,
        timezone,
        clock: moment.tz(time, timezone).format(timeLongFormat),
        ntp: ntpInfo ? ntpInfo.server : 'Not configured'
    };

}

function _getDNSServers(server, issue) {
    const { mode, dns } = server;
    const servers = dns.servers.list;
    const [ primary = 'Not configured', secondary = 'Not configured' ] = servers;

    return {
        icon: _selectIcon(mode === 'connected', servers.length > 0, issue, 'Reachable and working'),
        primary,
        secondary
    };
}

function _getDNSName(server, issue, name) {
    const { mode } = server;

    return {
        icon: _selectIcon(mode === 'CONNECTED', Boolean(name), issue, 'Resolvable to server\'s IP'),
        name: name || 'Not configured'
    };
}

function _getRemoteSyslog(server, issue, remoteSyslogConf) {
    const { mode, remoteSyslog, clockSkew } = server;
    const isConfigured = Boolean(remoteSyslogConf);
    const { protocol, address, port } = remoteSyslogConf || {};

    return {
        isConfigured,
        icon: _selectIcon(mode === 'CONNECTED', isConfigured, issue, 'Reachable and working'),
        address: isConfigured ? `${protocol.toLowerCase()}://${address}:${port}` : 'Not configured',
        lastStatusCheck: isConfigured ? moment(remoteSyslog.lastStatusCheck + clockSkew).fromNow() : ''
    };
}

function _getPhonehome(server, phoneHomeIssue, proxyIssue, proxyConf) {
    const { mode, phonehome, clockSkew } = server;
    const [issue] = [phoneHomeIssue, proxyIssue].filter(Boolean);
    const { endpoint, port } = proxyConf || {};

    return {
        icon: _selectIcon(mode === 'CONNECTED', true, issue, 'Reachable and working'),
        proxy: proxyConf ? `${endpoint}:${port}` : 'Not configured',
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
        clock: ko.observable(),
        ntp: ko.observable()
    };
    dnsServers = {
        icon: ko.observable({}),
        primary: ko.observable(),
        secondary: ko.observable()
    };
    dnsName = {
        icon: ko.observable({}),
        name: ko.observable()
    };
    remoteSyslog = {
        icon: ko.observable({}),
        isConfigured: ko.observable(),
        address: ko.observable(),
        lastStatusCheck: ko.observable()
    };
    phonehome = {
        icon: ko.observable({}),
        proxy: ko.observable(),
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
                serverTime: _getServerTime(server, issues.ntp),
                dnsServers: _getDNSServers(server, issues.dnsServers),
                dnsName: _getDNSName(server, issues.dnsNameResolution, system.dnsName),
                remoteSyslog: _getRemoteSyslog(server, issues.remoteSyslog, system.remoteSyslog),
                phonehome: _getPhonehome(server, issues.phonehome, issues.proxy, system.phonehome)
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

    onEditDateAndTime() {
        this.dispatch(openEditServerTimeSettingsModal(this.secret));
    }

    onEditDNSServers() {
        this.dispatch(openEditServerDNSSettingsModal(this.secret));
    }

    onNavigateToSystemAddressForm() {
        const url = realizeUri(this.managmentUrl, { section: 'system-address' });
        this.dispatch(requestLocation(url));
    }

    onNavigateToRemoteSyslogForm() {
        const url = realizeUri(this.managmentUrl, { section: 'remote-syslog' });
        this.dispatch(requestLocation(url));
    }

    onNavigateToProxyServerForm() {
        const url = realizeUri(this.managmentUrl, { section: 'proxy-server' });
        this.dispatch(requestLocation(url));
    }
}

export default {
    viewModel: ServerDetailsFormViewModel,
    template: template
};

