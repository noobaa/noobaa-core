/* Copyright (C) 2016 NooBaa */

function formatIssueMessage(subject, status, plural = false) {
    switch (status) {
        case 'FAULTY':
            return `${subject} ${plural ? 'are' : 'is'} faulty`;

        case 'UNREACHABLE':
            return `${subject} ${plural ? 'are' : 'is'} unreachable`;

        case 'UNKNOWN':
            return `${subject} has an unknown problem`;
    }
}

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
        issues.dnsServers = formatIssueMessage('DNS servers', dns_servers, true);
    }

    const { dns_name_resolution } = services_status;
    if (dns_name_resolution && dns_name_resolution !== 'OPERATIONAL') {
        issues.dnsName = 'System DNS name does not point to this server\'s IP';
    }

    const { phonehome_server } = services_status;
    if (phonehome_server && phonehome_server.status !== 'OPERATIONAL') {
        issues.phoneHomeServer = formatIssueMessage('Phone Home server', phonehome_server.status);
    }

    const { phonehome_proxy } = services_status;
    if (phonehome_proxy && phonehome_proxy !== 'OPERATIONAL') {
        issues.phoneHomeProxy = formatIssueMessage('Phone Home proxy', phonehome_proxy);
    }

    const { ntp_server } = services_status;
    if (ntp_server && ntp_server !== 'OPERATIONAL') {
        issues.ntpServer = formatIssueMessage('NTP server', ntp_server);
    }

    const { remote_syslog } = services_status;
    if (remote_syslog && remote_syslog.status !== 'OPERATIONAL') {
        issues.remoteSyslog = formatIssueMessage('Remote syslog', remote_syslog.status);
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
                    Boolean(issues.dns_servers) ||
                    Boolean(issues.dns_name_resolution) ||
                    Boolean(issues.ntp_server) ||
                    Boolean(issues.clusterConnectivity);
            }
        )
        .length;


    if (issueCount > connected / 2) {
        return 'WITH_ISSUES';
    }

    return 'HEALTHY';
}
