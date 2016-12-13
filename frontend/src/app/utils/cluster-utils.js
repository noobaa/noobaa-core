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
    const warnings = [];

    if (debug_level > 0) {
        warnings.push('Server is in debug mode');
    }

    if (server.version !== systemInfo.version) {
        warnings.push('Server version is not synced with master');
    }

    const { dns_servers } = services_status;
    if (dns_servers && dns_servers !== 'OPERATIONAL') {
        warnings.push(warningText('DNS servers', dns_servers, true));
    }

    const { dns_name_resolution } = services_status;
    if (dns_name_resolution && dns_name_resolution !== 'OPERATIONAL') {
        warnings.push(`Server name is not resolvable under DNS name ${systemInfo.dns_name}`);
    }

    const { phonehome_server } = services_status;
    if (phonehome_server && phonehome_server !== 'OPERATIONAL') {
        warnings.push(warningText('Phonehome server', phonehome_server));
    }

    const { phonehome_proxy } = services_status;
    if (phonehome_proxy && phonehome_proxy !== 'OPERATIONAL') {
        warnings.push(warningText('Phonehome proxy', phonehome_proxy));
    }

    const { ntp_server } = services_status;
    if (ntp_server && ntp_server !== 'OPERATIONAL') {
        warnings.push(warningText('NTP server', ntp_server));
    }

    const { remote_syslog } = services_status;
    if (remote_syslog && remote_syslog !== 'OPERATIONAL') {
        warnings.push(warningText('Remote syslog', remote_syslog));
    }

    const { internal_cluster_connectivity = [] } = services_status;
    const hasConnectivityIssues = internal_cluster_connectivity.some(
        status => status !== 'OPERATIONAL'
    );
    if (hasConnectivityIssues) {
        warnings.push('Cannot reach some cluster members');
    }

    return warnings;
}
