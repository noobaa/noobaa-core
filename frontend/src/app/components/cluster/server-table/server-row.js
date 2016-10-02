import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze } from 'utils';

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
    constructor(server) {
        super();

        this.state = ko.pureComputed(
            () => server() ? stateIconMapping[server().status] : ''
        );

        this.hostname = ko.pureComputed(
            () => server() ? server().hostname : ''
        );

        this.address = ko.pureComputed(
            () => server() ? server().address : ''
        );

        this.memoryUsage = ko.pureComputed(
            () => server().memory_usage
        ).extend({
            formatNumber: { format: '%' }
        });

        this.cpuUsage = ko.pureComputed(
            () => server().cpu_usage
        ).extend({
            formatNumber: { format: '%' }
        });

        this.version = ko.pureComputed(
            () => server() ? server().version : 'N/A'
        );

        this.secret = ko.pureComputed(
            () => server() && server().secret
        );

        this.primaryDNS = ko.pureComputed(
            () => (server() && server().dns_servers[0]) || 'Not set'
        );

        this.secondaryDNS = ko.pureComputed(
            () => (server() && server().dns_servers[1]) || 'Not set'
        );

        this.timeConfig = ko.pureComputed(
            () => {
                let ntpServer = server() && server().ntp_server;

                if (ntpServer) {
                    return 'Using ';
                } else {
                    return 'No NTP (network time protocol) server configured';
                }
            }
            // {
            //
            //     // return ntpServer ?
            //     //     ~Using network time server at <span

            //     // return this.ntpServer()
            // }`Set to use ${this.ntpServer ? 'network' : 'manual'} time`
        );
    }
}
