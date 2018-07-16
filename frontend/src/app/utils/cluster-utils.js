/* Copyright (C) 2016 NooBaa */

import { deepFreeze, omitUndefined, groupBy, get } from 'utils/core-utils';

export function getServerIssues(server, systemVersion, minRequirements) {
    const { debug_level, services_status = {} } = server;
    const issues = {};

    if (debug_level > 0) {
        issues.debug_level ='Server is in debug mode';
    }

    if (server.version !== systemVersion) {
        issues.version = 'Server version is not synced with master';
    }

    const { dns_servers } = services_status;
    if (dns_servers && dns_servers !== 'OPERATIONAL') {
        issues.dnsServers = _formatIssueMessage('DNS servers', dns_servers, true);
    }

    const { dns_name_resolution } = services_status;
    if (dns_name_resolution && dns_name_resolution !== 'OPERATIONAL') {
        issues.dnsName = 'System DNS name does not point to this server\'s IP';
    }

    const { phonehome_server } = services_status;
    if (phonehome_server && phonehome_server.status !== 'OPERATIONAL') {
        issues.phoneHomeServer = _formatIssueMessage('Phone Home server', phonehome_server.status);
    }

    const { phonehome_proxy } = services_status;
    if (phonehome_proxy && phonehome_proxy !== 'OPERATIONAL') {
        issues.phoneHomeProxy = _formatIssueMessage('Proxy', phonehome_proxy);
    }

    const { ntp_server } = services_status;
    if (ntp_server && ntp_server !== 'OPERATIONAL') {
        issues.ntpServer = _formatIssueMessage('NTP server', ntp_server);
    }

    const { remote_syslog } = services_status;
    if (remote_syslog && remote_syslog.status !== 'OPERATIONAL') {
        issues.remoteSyslog = _formatIssueMessage('Remote syslog', remote_syslog.status);
    }

    const { cluster_communication = {} } = services_status;
    const { test_completed, results = [] } = cluster_communication;
    const hasConnectivityIssues = test_completed && results.some(
        ({ status }) => status !== 'OPERATIONAL'
    );
    if (hasConnectivityIssues) {
        issues.clusterConnectivity = 'Cannot reach some cluster members';
    }

    const { storage, memory, cpus } = server;
    if (storage.total < minRequirements.storage ||
        memory.total < minRequirements.ram ||
        cpus.count < minRequirements.cpu_count) {
        issues.minRequirements = 'Server specs are below minimum requirements';
    }

    return issues;
}

export function getClusterStatus(cluster, systemVersion) {
    const { servers } = cluster.shards[0];
    const connected = servers
        .filter( server => server.status === 'CONNECTED' )
        .length;

    if (connected < Math.floor(servers.length / 2) + 1) {
        return 'UNHEALTHY';
    }

    const issueCount = servers
        .filter(
            server => {
                if (server.status !== 'CONNECTED') {
                    return false;
                }

                const issues = getServerIssues(server, systemVersion, cluster.min_requirements);
                return Boolean(issues.version) ||
                    Boolean(issues.dnsServers) ||
                    Boolean(issues.dnsName) ||
                    Boolean(issues.ntpServer) ||
                    Boolean(issues.clusterConnectivity);
            }
        )
        .length;


    if (issueCount > connected / 2) {
        return 'WITH_ISSUES';
    }

    return 'HEALTHY';
}


// ---------------------------------
// New arch utils
// ---------------------------------

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
        name: 'working',
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
    return supportHighAvailability ?
        (isHighlyAvailable ? 'Highly Available' : 'Not highly available') :
        'Not configured for high availability';
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
                            message: pkg.error
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
