/* Copyright (C) 2016 NooBaa */

import template from './server-details-form.html';
import Observer from 'observer';
import { deepFreeze, isDefined} from 'utils/core-utils';
import { summarizeServerIssues, getServerDisplayName } from 'utils/cluster-utils';
import { aggregateStorage } from 'utils/storage-utils';
import { formatSize } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { timeLongFormat } from 'config';
import ko from 'knockout';
import { getMany } from 'rx-extensions';
import moment from 'moment-timezone';
import { action$, state$ } from 'state';
import * as routes from 'routes';
import { timeTickInterval } from 'config';
import {
    openEditServerDetailsModal,
    openEditServerDNSSettingsModal,
    openEditServerTimeSettingsModal,
    openChangeClusterConnectivityIpModal
} from 'action-creators';

const icons = deepFreeze({
    healthy: {
        name: 'healthy',
        css: 'success'
    },
    problem: {
        name: 'problem',
        css: 'error'
    },
    unavailable: {
        name: 'healthy',
        css: 'disabled'
    }
});

const sections = deepFreeze({
    systemAddress: 'system-address',
    remoteSyslog: 'remote-syslog',
    phoneHome: 'phone-home'
});

function _getInfoSheet(server, minRequirements, internalResourcesList, baseResourcesRoute) {
    const [ address = '', ...addresses ] = server.addresses;
    const additionalAddresses = addresses.length ? addresses : 'None';
    const { hostname, locationTag, memory, storage, cpus } = server;
    const serverName = getServerDisplayName(server);
    const isNotEnoughMemory = memory.total < minRequirements.memory;
    const isNotEnoughStorage = storage.total < minRequirements.storage;
    const isNotEnoughCpus = cpus.count < minRequirements.cpus;
    const isMaster = server.isMaster ? 'Yes' : 'No';
    const totalMemory = {
        text: formatSize(memory.total),
        message: isNotEnoughMemory ? formatSize(minRequirements.memory) : ''
    };

    const totalStorage = {
        text: formatSize(storage.total),
        message: isNotEnoughStorage ? formatSize(minRequirements.storage) : ''
    };
    
    const cpusCount = {
        text: `${cpus.count} CPUs`,
        message: isNotEnoughCpus ? `${minRequirements.cpus} CPUs` : ''
    };

    const { used = 0, total = 0 }  = aggregateStorage(
        ...internalResourcesList.map(resource => resource.storage)
    );

    const internalStorage = {
        used: formatSize(used),
        total: formatSize(total),
        href: realizeUri(baseResourcesRoute, { tab: 'internal' })
    };

    return [
        {
            label: 'Cluster Connectivity IP',
            value: address
        },
        {
            label: 'Additional IPs',
            value: additionalAddresses
        },
        {
            label: 'Server Name',
            value: serverName
        },
        {
            label: 'Hostname',
            value: hostname
        },
        {
            label: 'Location Tag',
            value: locationTag
        },
        {
            label: 'Is Master',
            value: isMaster
        },
        {
            label: 'Total Memory',
            value: totalMemory,
            template: 'hardwareInfo'
        },
        {
            label: 'Total Disk Size',
            value: totalStorage,
            template: 'hardwareInfo'
        },
        {
            label: 'Number of CPUs',
            value: cpusCount,
            template: 'hardwareInfo'
        },
        {
            label: 'Internal Storage Resource',
            value: internalStorage,
            template: 'internalStorage'
        }
    ];
}

function _getVersion(server, issues) {
    const version = {
        text: server.version
    };

    if (server.mode !== 'CONNECTED') {
        version.icon = icons.unavailable;
        version.tooltip = '';
    } else {
        version.icon = issues.version ? icons.problem : icons.healthy;
        version.tooltip = {
            text: issues.version || 'Synced with master',
            align: 'start'
        };
    }

    return version;
}

function _getServerTime(server, issues) {
    const { mode, secret } = server;
    const serverTime = {
        secret,
        ntp: server.ntp && server.ntp.server || 'Not configured'
    };

    if (mode !== 'CONNECTED') {
        serverTime.icon = icons.unavailable;
        serverTime.tooltip = '';
    } else {
        serverTime.icon = issues.ntp ? icons.problem : icons.healthy;
        serverTime.tooltip = {
            text: issues.ntpServer || 'Working Properly',
            align: 'start'
        };
    }

    return serverTime;
}

function _getDNSServers(server, issues) {
    const { dns, secret, mode } = server;
    const servers = dns.servers.list;

    const dnsServers = {
        secret,
        primary: servers[0] || 'Not Configured' ,
        secondary: servers[1] || 'Not Configured'
    };

    if (mode !== 'CONNECTED') {
        dnsServers.icon = icons.unavailable;
        dnsServers.tooltip = '';
    } else if (servers.length === 0) {
        dnsServers.icon = icons.unavailable;
        dnsServers.tooltip = 'Not configured';
    } else {
        dnsServers.icon = issues.dnsServers ? icons.problem : icons.healthy;
        dnsServers.tooltip = {
            text: issues.dnsServers || 'Reachable and working',
            align: 'start'
        };
    }

    return dnsServers;
}

function _getDNSName(server, issues, name, configurationHref) {
    const dnsName = {
        configurationHref,
        name: name || 'Not configured'
    };

    if (server.mode !== 'CONNECTED') {
        dnsName.icon = icons.unavailable;
        dnsName.tooltip = '';
    } else if (!name) {
        dnsName.icon = icons.unavailable;
        dnsName.tooltip = '';
    } else {
        dnsName.icon = issues.dnsName ? icons.problem : icons.healthy;
        dnsName.tooltip = {
            text: issues.dnsName || 'Resolvable to server\'s IP',
            align: 'start'
        };
    }

    return dnsName;
}

function _getRemoteSyslog(server, issues, remoteSyslogConfig,  timezone, configurationHref) {
    const { protocol, address, port } = remoteSyslogConfig || {};
    const isConfigured = Boolean(server.remoteSyslog);
    const { lastStatusCheck } = server.remoteSyslog || {};

    const remoteSyslog = {
        configurationHref,
        isConfigured,
        text: server.remoteSyslog ? `${protocol}://${address}:${port}` : '',
        lastRSyslogSync: lastStatusCheck ? moment.tz(lastStatusCheck * 1000, timezone).format(timeLongFormat) : 'Not Tested Yet'
    };

    if (server.mode !== 'CONNECTED') {
        remoteSyslog.icon = icons.unavailable;
        remoteSyslog.tooltip = '';
    } else if (!isConfigured) {
        remoteSyslog.icon = icons.unavailable;
        remoteSyslog.tooltip = 'Not configured';
    } else {
        remoteSyslog.icon = issues.remoteSyslog ? icons.problem : icons.healthy;
        remoteSyslog.tooltip = {
            text: issues.remoteSyslog || 'Reachable and working',
            align: 'start'
        };
    }

    return remoteSyslog;
}

function _getPhoneHome(server, phonehome, issues,  timezone, configurationHref) {
    const { phoneHomeServer, phoneHomeProxy } = issues;
    const phoneHomeIssues = [ phoneHomeServer, phoneHomeProxy ].filter(isDefined);
    const lastPhoneHomeSync = server.phonehome.lastStatusCheck ?
        moment.tz(server.phonehome.lastStatusCheck * 1000, timezone).format(timeLongFormat) :
        'Not Synced Yet';

    const phoneHome = {
        lastPhoneHomeSync,
        configurationHref,
        proxy: phonehome || 'Not Configured'
    };

    if (server.mode !== 'CONNECTED') {
        phoneHome.icon = icons.unavailable;
        phoneHome.tooltip = '';
    } else {
        phoneHome.icon = (issues.phoneHomeServer || issues.phoneHomeProxy) ? icons.problem : icons.healthy;
        phoneHome.tooltip = {
            text: phoneHomeIssues.length > 0 ? phoneHomeIssues : 'Reachable and working',
            align: 'start'
        };
    }

    return phoneHome;
}

class ServerDetailsFormViewModel extends Observer {
    secret = '';
    server = ko.observable();
    isConnected = ko.observable();
    isMaster = ko.observable();
    issues = ko.observable();
    time = ko.observable();
    timezone = ko.observable();
    minRequirements = ko.observable();
    isServerLoaded = ko.observable();
    infoSheet = ko.observableArray();
    version = ko.observable();
    serverTime = ko.observable();
    dnsServers = ko.observable();
    dnsName = ko.observable();
    remoteSyslog = ko.observable();
    phoneHome = ko.observable();
    formattedTime = ko.observable();

    constructor({ serverSecret }) {
        super();

        this.ticker = setInterval(this.onTick.bind(this), timeTickInterval);
        this.secret = ko.unwrap(serverSecret);

        this.observe(
            state$.pipe(
                getMany(
                    'topology',
                    'system',
                    'internalResources',
                    'location'
                )
            ),
            this.onState
        );

        this.onEditDNSServers = this.onEditDNSServers.bind(this);
        this.onEditDateAndTime = this.onEditDateAndTime.bind(this);
    }

    onState([topology, system, internalResources, location]) {
        if (!topology || !system) {
            this.isServerLoaded(false);
            return;
        }

        const { params } = location;
        const { serverMinRequirements } = topology;
        const server = topology.servers[this.secret];
        const { mode, isMaster, time, timezone } = server;
        const internalResourcesList = Object.values(internalResources);
        const baseConfigurationRoute = realizeUri(routes.management, { system: params.system, tab: 'settings' }, {}, true);
        const baseResourcesRoute = realizeUri(routes.resources, { system: params.system }, {}, true);
        const serverDnsConfigurationHref = realizeUri(baseConfigurationRoute, { section: sections.systemAddress });
        const remoteSyslogConfigurationHref = realizeUri(baseConfigurationRoute, { section: sections.remoteSyslog });
        const phoneHomeConfigurationHref = realizeUri(baseConfigurationRoute, { section: sections.phoneHome });
        const isConnected = mode === 'CONNECTED';
        const issues = summarizeServerIssues(server, system.version, serverMinRequirements);
        const formattedTime = moment.tz(time, this.timezone()).format(timeLongFormat);

        this.isConnected(isConnected);
        this.isMaster(isMaster);
        this.issues(issues);
        this.time(time);
        this.timezone(timezone);
        this.minRequirements(serverMinRequirements);
        this.infoSheet(_getInfoSheet(server, serverMinRequirements, internalResourcesList, baseResourcesRoute));
        this.version(_getVersion(server, issues));
        this.serverTime(_getServerTime(server, issues));
        this.formattedTime(formattedTime);
        this.dnsServers(_getDNSServers(server, issues));
        this.dnsName(_getDNSName(server, issues, system.dnsName, serverDnsConfigurationHref));
        this.remoteSyslog(_getRemoteSyslog(server, issues, system.remoteSyslog, timezone, remoteSyslogConfigurationHref));
        this.phoneHome(_getPhoneHome(server, system.phonehome, issues, timezone, phoneHomeConfigurationHref));
        this.isServerLoaded(true);
    }

    onChangeClusterConnectivityIp() {
        action$.next(openChangeClusterConnectivityIpModal(this.secret));
    }

    onEditServerDetails() {
        action$.next(openEditServerDetailsModal(this.secret));
    }

    onEditDNSServers() {
        action$.next(openEditServerDNSSettingsModal(this.secret));
    }

    onEditDateAndTime() {
        action$.next(openEditServerTimeSettingsModal(this.secret));
    }

    onTick() {
        if (!this.time()) return;

        const time = this.time() + timeTickInterval;
        const formattedTime = moment.tz(time, this.timezone()).format(timeLongFormat);
        this.time(time);
        this.formattedTime(formattedTime);
    }

    dispose() {
        clearInterval(this.ticker);
        super.dispose();
    }
}

export default {
    viewModel: ServerDetailsFormViewModel,
    template: template
};

