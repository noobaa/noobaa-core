import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { systemInfo } from 'model';
import { deepFreeze, formatSize } from 'utils/all';

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
        name: 'notif-warning',
        css: 'warning'
    }
});

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

function getServerWarnings(server) {
    const warnings = [];
    const { debug_level, services_status } = server;

    if (debug_level > 0) {
        warnings.push('Server is in debug mode');
    }

    const { dns_servers } = services_status;
    if (dns_servers && dns_servers !== 'OPERATIONAL') {
        warnings.push(warningText('DNS servers', dns_servers, true));
    }

    const { dns_name_resolution } = services_status;
    if (dns_name_resolution && dns_name_resolution !== 'OPERATIONAL') {
        warnings.push(warningText('DNS Name resolution', dns_name_resolution));
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

    const { internal_cluster_connectivity } = services_status;
    const hasConnectivityIssues = internal_cluster_connectivity.some(
        status => status !== 'OPERATIONAL'
    );
    if (hasConnectivityIssues) {
        warnings.push('Cannot reach some cluster members');
    }

    return warnings;
}

export default class ServerRowViewModel extends Disposable {
    constructor(server) {
        super();

        this.state = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';
                }

                const { status } = server();
                if (status === 'CONNECTED') {

                    const warnings = getServerWarnings(server());
                    if (warnings.length > 0) {
                        return Object.assign(
                            {
                                tooltip: {
                                    text: warnings,
                                    align: 'start'
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
                    params: { server: `${hostname}-${secret}` }
                };

                return { text, href };
            }
        );

        this.address = ko.pureComputed(
            () => server() ? server().address : ''
        );

        this.diskUsage = ko.pureComputed(
            () => {
                if(!server()) {
                    return '';
                }

                const { free, total } = server().storage;
                const used = total - free;
                const usedPercents = used / total;
                const text = numeral(usedPercents).format('0%');
                const tooltip = `Using ${formatSize(used)} out of ${formatSize(total)}`;

                let css = '';
                if(usedPercents >= diskUsageWarningBound) {
                    css = usedPercents >= diskUsageErrorBound ? 'error' : 'warning';
                }

                return { text, tooltip, css };
            }
        );

        this.memoryUsage = ko.pureComputed(
            () => {
                if (!server()) {
                    return 'N/A';
                }

                return {
                    text: numeral(server().memory_usage).format('%'),
                    tooltip: 'Avg. over the last minute'
                };
            }
        );

        this.cpuUsage = ko.pureComputed(
            () => {
                if (!server()) {
                    return 'N/A';
                }

                return {
                    text: numeral(server().cpu_usage).format('%'),
                    tooltip: 'Avg. over the last minute'
                };
            }
        );

        this.version = ko.pureComputed(
            () => server() ? server().version : 'N/A'
        );

        this.location = ko.pureComputed(
            () => server() ? server().location : 'No location tag'
        );
    }
}
