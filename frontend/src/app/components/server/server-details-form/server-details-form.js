import template from './server-details-form.html';
import Disposable from 'disposable';
import { systemInfo, routeContext } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { lastSegment } from 'utils/string-utils';
import ko from 'knockout';

const iconMapping = deepFreeze({
    FAULTY: {
        name: 'notif-error'
    },
    UNREACHABLE: {
        name: 'notif-error'
    },
    UNKNOWN: {
        name: 'notif-error'
    },
    OPERATIONAL: {
        name: 'notif-warning'
    }
});

function getServer(cluster, secret) {
    return cluster.shards[0].servers.find(
        server => server.secret === secret
    );
}

class ServerDetailsFormViewModel extends Disposable{
    constructor() {
        super();

        const server = ko.pureComputed(
            () => {
                if (!systemInfo()){
                    return {};
                }

                const secret = lastSegment(routeContext().params.server, '-');
                return getServer(systemInfo().cluster, secret);
            }
        );

        const master = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return {};
                }

                const masterSecret = systemInfo().cluster.master_secret;
                return getServer(systemInfo().cluster, masterSecret);
            }
        );

        const isMaster = ko.pureComputed(
            () => server() === master()
        );

        const isVersionSynced = ko.pureComputed(
            () => server().secret && master().secret &&
                (isMaster() || server().version === master().version)
        );

        this.infoSheet = [
            {
                label: 'IP Address',
                value: ko.pureComputed(
                    () => server().address
                )
            },
            {
                label: 'Hostname',
                value: ko.pureComputed(
                    () => server().hostname
                )
            },
            {
                label: 'Location Tag',
                value: ko.pureComputed(
                    () => server().location
                )
            },
            {
                label: 'isMaster',
                value: ko.pureComputed(
                    () => isMaster() ? 'yes' : 'no'
                )
            }
        ];

        this.version = ko.pureComputed(
            () => {
                let note = '';
                if (!isMaster()) {
                    note = isVersionSynced() ?
                        '(Synced with master)' :
                        '<span class="error">(Not synced with master)</span>';
                }

                return `${server().version} ${note}`;
            }
        );

        this.ntpServer = ko.pureComputed(
            () => server().ntp_server || 'Not configured'
        );

        const dnsServers = ko.pureComputed(
            () => server().dns_servers || []
        );

        this.primaryDNS = ko.pureComputed(
            () => dnsServers()[0] || 'Not set'
        );

        this.secondaryDNS = ko.pureComputed(
            () => dnsServers()[1] || 'Not set'
        );

        // this.remoteSyslog = ko.pureComputed(
        //     () => server().
        // );

    }
}

export default {
    viewModel: ServerDetailsFormViewModel,
    template: template
};

