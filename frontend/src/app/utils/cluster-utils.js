/* Copyright (C) 2016 NooBaa */

import { deepFreeze, omitUndefined, groupBy, get } from 'utils/core-utils';

const clsuterModeToIcon = deepFreeze({
    UNHEALTHY: {
        name: 'problem',
        css: 'error',
        tooltip: 'Not enough connected servers'
    },
    WITH_ISSUES: {
        name: 'problem',
        css: 'warning',
        tooltip: 'High number of issues'
    },
    HEALTHY: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    }
});

const serverModeToIcon = deepFreeze({
    CONNECTED: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    },

    IN_PROGRESS: {
        name: 'in-progress',
        css: 'warning',
        tooltip: 'In Progress'
    },

    DISCONNECTED: {
        name: 'problem',
        css: 'error',
        tooltip: 'Problem'
    }
});

const majorIssues = deepFreeze([
    'version',
    'dnsServers',
    'dnsNameResolution',
    'ntp',
    'clusterConnectivity'
]);

const upgradePackageStateToPriority = deepFreeze({
    COMPLETED: 0,
    TESTED: 1,
    TESTING: 2,
    NO_PACKAGE: 3,
    UPLOADING: 4
});

function _formatIssueMessage(subject, status, plural = false) {
    switch (status) {
        case 'FAULTY':
            return `${subject} ${plural ? 'are' : 'is'} faulty`;

        case 'UNREACHABLE':
            return `${subject} ${plural ? 'are' : 'is'} unreachable`;

        case 'UNKNOWN':
            return `${subject} has an unknown problem`;
    }
}

export function summarizeServerIssues(server, systemVersion, minRequirements) {
    const dnsServerStatus = server.dns.servers.status;
    const dnsNameResolutionStatus = (server.dns.nameResolution || {}).status;
    const proxyStatus = (server.proxy || {}).status;
    const phonehomeStatus = server.phonehome.status;
    const ntpServerStatus = (server.ntp || {}).status;
    const remoteSyslogStatus = (server.remoteSyslog || {}).status;
    const clsuterConnectivityStatus = Object.values(server.clusterConnectivity)
        .some(status => status !== 'OPERATIONAL');
    const minRequirementsStatus =
        (server.storage.total < minRequirements.storage) ||
        (server.memory.total < minRequirements.memory) ||
        (server.cpus.count < minRequirements.cpus);

    return omitUndefined({
        debugMode: server.debugMode ?
            'Server is in debug mode' :
            undefined,
        version: (server.version !== systemVersion) ?
            'Server version is not synced with master' :
            undefined,
        dnsNameResolution: (dnsNameResolutionStatus && dnsNameResolutionStatus !== 'OPERATIONAL') ?
            'System DNS name does not point to this server\'s IP' :
            undefined,
        dnsServers: _formatIssueMessage('DNS servers', dnsServerStatus, true),
        proxy: _formatIssueMessage('System proxy', proxyStatus),
        phonehome: _formatIssueMessage('Phone Home server', phonehomeStatus),
        ntp: _formatIssueMessage('NTP server', ntpServerStatus),
        remoteSyslog: _formatIssueMessage('Remote syslog', remoteSyslogStatus),
        clusterConnectivity: clsuterConnectivityStatus ?
            'Cannot reach some cluster members' :
            undefined,
        minRequirements: minRequirementsStatus ?
            'Server specs are below minimum requirements' :
            undefined
    });
}

export function getServerDisplayName(server) {
    const { hostname, secret } = server;
    return `${hostname}-${secret}`;
}

export function getClsuterHAState(topology) {
    const { supportHighAvailability, isHighlyAvailable }= topology;
    return (
        (!supportHighAvailability && 'Not configured for high availability') ||
        (isHighlyAvailable && 'Highly Available') ||
        'Not highly available'
    );
}

export function getClusterStateIcon(topology, systemVersion) {
    const servers = Object.values(topology.servers);
    const connected = servers.filter(server => server.mode === 'CONNECTED');
    const issueCount = connected.reduce(
        (count, server) => {
            const serverIssues = summarizeServerIssues(
                server,
                systemVersion,
                topology.serverMinRequirements
            );

            const hasMajorIssues = Object.keys(serverIssues)
                .filter(issue => majorIssues.includes(issue))
                .length > 0;

            return count + Number(hasMajorIssues);
        },
        0
    );

    const { supportHighAvailability, isHighlyAvailable }= topology;
    const mode =
        (supportHighAvailability && !isHighlyAvailable && 'UNHEALTHY') ||
        ((issueCount > connected.length / 2) && 'WITH_ISSUES') ||
        'HEALTHY';

    return clsuterModeToIcon[mode];
}

export function aggregateUpgradePackageInfo(serverList) {
    const byPkgState = groupBy(
        serverList,
        server => get(
            server,
            ['upgrade', 'package', 'state'],
            'NO_PACKAGE'
        ),
        server => ({
            ...get(server, ['upgrade', 'package'], {}),
            server: server.secret
        })
    );

    const state = Object.keys(byPkgState)
        .reduce((state1, state2) => {
            const pri1 = upgradePackageStateToPriority[state1];
            const pri2 = upgradePackageStateToPriority[state2];
            return pri1 > pri2 ? state1 : state2;
        });

    switch (state) {
        case 'NO_PACKAGE': {
            return { state };
        }
        case 'UPLOADING': {
            const { progress } = byPkgState.UPLOADING[0];
            return { state, progress };
        }
        case 'TESTING': {
            const testedCount = (byPkgState.TESTED || []).length;
            const progress = testedCount / serverList.length;
            return { state,progress };
        }
        case 'TESTED': {
            return byPkgState.TESTED
                .reduce(
                    (aggr, pkg) => {
                        aggr.version = aggr.version || pkg.version;
                        aggr.testedAt = Math.max(aggr.testedAt, pkg.testedAt);
                        if (pkg.error) aggr.errors.push({
                            server: pkg.server,
                            ...pkg.error
                        });
                        return aggr;
                    },
                    { state, testedAt: -Infinity, errors: [] }
                );
        }
    }
}

export function getServerStateIcon(server) {
    return serverModeToIcon[server.mode];
}
