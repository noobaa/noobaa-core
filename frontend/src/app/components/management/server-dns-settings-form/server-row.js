import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';

const stateIconMapping = deepFreeze({
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

export default class ServerRowViewModel extends Disposable {
    constructor(server, showDNSSettingsModal ) {
        super();

        this.state = ko.pureComputed(
            () => server() ? stateIconMapping[server().status] : ''
        );

        this.serverName = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';
                }

                const { secret, hostname } = server();
                const masterSecret = systemInfo() && systemInfo().cluster.master_secret;
                const suffix = secret === masterSecret ? '(Master)' : '';
                return `${hostname}-${secret} ${suffix}`;

            }
        );

        this.address = ko.pureComputed(
            () => server() ? server().address : ''
        );

        const dnsServers = ko.pureComputed(
            () => server() ? server().dns_servers : []
        );

        this.primaryDNS = ko.pureComputed(
            () => dnsServers()[0] || 'not set'
        );

        this.secondaryDNS = ko.pureComputed(
            () => dnsServers()[1] || 'not set'
        );

        this.actions = {
            text: 'Edit',
            click: showDNSSettingsModal
        };
    }
}
