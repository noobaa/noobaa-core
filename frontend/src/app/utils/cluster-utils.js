function warningText(subject, status, plural = false) {
    switch (status) {
        case 'FAULTY':
            return `${subject} ${plural ? 'are' : 'is'} faulty`;

        case 'UNREACHABLE':
            return `${subject} ${plural ? 'are' : 'is'} unreachable`;

        case 'UNKNOWN':
            return `${subject} has an unknown problem`;
    }
}


export function getServerIssues(server, systemInfo) {
    const { debug_level, services_status } = server;
    const issues = {};

    if (debug_level > 0) {
        issues.debug_level ='Server is in debug mode';
    }

    if (server.version !== systemInfo.version) {
        issues.version = 'Server version is not synced with master';
    }

    const { dns_servers } = services_status;
    if (dns_servers && dns_servers !== 'OPERATIONAL') {
        issues.dnsServers = warningText('DNS servers', dns_servers, true);
    }

    const { dns_name_resolution } = services_status;
    if (dns_name_resolution && dns_name_resolution !== 'OPERATIONAL') {
        issues.dnsName = 'System DNS name does not point to this server\'s IP';
    }

    const { phonehome_server } = services_status;
    if (phonehome_server && phonehome_server !== 'OPERATIONAL') {
        issues.phoneHomeServer = warningText('Phone Home server', phonehome_server);
    }

    const { phonehome_proxy } = services_status;
    if (phonehome_proxy && phonehome_proxy !== 'OPERATIONAL') {
        issues.phoneHomeProxy = warningText('Phone Home proxy', phonehome_proxy);
    }

    const { ntp_server } = services_status;
    if (ntp_server && ntp_server !== 'OPERATIONAL') {
        issues.ntpServer = warningText('NTP server', ntp_server);
    }

    const { remote_syslog } = services_status;
    if (remote_syslog && remote_syslog !== 'OPERATIONAL') {
        issues.remoteSyslog = warningText('Remote syslog', remote_syslog);
    }

    const { internal_cluster_connectivity = {} } = services_status;
    const { test_completed, results = [] } = internal_cluster_connectivity;
    const hasConnectivityIssues = test_completed && results.some(
        ({ status }) => status !== 'OPERATIONAL'
    );
    if (hasConnectivityIssues) {
        issues.clusterConnectivity = 'Cannot reach some cluster members';
    }

    return issues;
}
