import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { collectDiagnosticsState, systemInfo } from 'model';
import { downloadServerDiagnosticPack, setServerDebugLevel } from 'actions';
import { deepFreeze, isUndefined, formatSize } from 'utils';

const diskUsageErrorBound = .95;
const diskUsageWarningBound = .85;

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
            () => {
                let masterSecret = systemInfo() && systemInfo().cluster['master_secret'];
                return server() ?
                    `${server().hostname} ${server().secret === masterSecret ? '(Master)' : ''}` :
                    '';
            }
        );

        this.address = ko.pureComputed(
            () => server() ? server().address : ''
        );

        this.diskUsage = ko.pureComputed(
            () => {
                let { free, total } = server().storage;
                let used = total - free;
                let text = numeral(used / total).format('0%');
                let tooltip = `${formatSize(used)} used of ${formatSize(total)}`;
                let css = '';
                if(used / total >= diskUsageWarningBound) {
                    css = used / total >= diskUsageErrorBound ? 'error' : 'warning';
                }

                return { text, tooltip, css };
            }
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

                return ntpServer ?
                    `Using NTP server at ${ntpServer}` :
                    'Using local server time';
            }
        );

        this.debugLevel = ko.pureComputed(
            () => {
                let level = server() && server().debug_level;
                return isUndefined(level) ? 0 : level;
            }
        );

        this.debugLevelText = ko.pureComputed(
            () => this.debugLevel() > 0 ? 'High' : 'Low'
        );

        this.toogleDebugLevelButtonText = ko.pureComputed(
            () => `${this.debugLevel() > 0 ? 'Lower' : 'Raise' } Debug Level`
        );

        this.debugLevelCss = ko.pureComputed(
            () => ({ 'high-debug-level': this.debugLevel() > 0 })
        );

        this.isCollectingDiagnostics = ko.pureComputed(
            () => Boolean(collectDiagnosticsState()[
                `server:${this.hostname()}`
            ])
        );
    }

    toogleDebugLevel() {
        let newDebugLevel = this.debugLevel() === 0 ? 5 : 0;
        return setServerDebugLevel(this.secret(), this.hostname(), newDebugLevel);
    }

    downloadDiagnosticPack() {
        downloadServerDiagnosticPack(this.secret(), this.hostname());
    }
}
