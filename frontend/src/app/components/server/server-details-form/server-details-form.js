import template from './server-details-form.html';
import Disposable from 'disposable';
import { systemInfo, serverTime } from 'model';
import { deepFreeze, isDefined} from 'utils/core-utils';
import { getServerIssues } from 'utils/cluster-utils';
import { loadServerTime } from 'actions';
import ko from 'knockout';

const icons = deepFreeze({
    healthy: {
        name: 'healthy',
        css: 'success'
    },
    problem: {
        name: 'problem',
        css: 'error'
    },
    unavailable: {
        name: 'healthy',
        css: 'disabled'
    }
});

class ServerDetailsFormViewModel extends Disposable{
    constructor({ serverSecret }) {
        super();

        this.secret = serverSecret;

        this.server = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return {};
                }

                const mySecret = ko.unwrap(serverSecret);
                return systemInfo().cluster.shards[0].servers.find(
                    ({ secret }) => secret === mySecret
                );
            }
        );

        this.isConnected = ko.pureComputed(
            () => this.server().status === 'CONNECTED'
        );

        this.isMaster = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return false;
                }

                const masterSecret = systemInfo().cluster.master_secret;
                return this.server().secret == masterSecret;
            }
        );

        this.issues = ko.pureComputed(
            () => systemInfo() ? getServerIssues(this.server(), systemInfo().version) : {}
        );

        this.clock = ko.observableWithDefault(
            () => serverTime() && serverTime().server ===  ko.unwrap(serverSecret) ?
                serverTime().time * 1000 :
                0
        );
        this.addToDisposeList(
            setInterval(
                () => this.clock() && this.clock(this.clock() + 1000),
                1000
            ),
            clearInterval
        );

        this.infoSheet = this.getInfoSheet();
        this.version = this.getVersion();
        this.serverTime = this.getServerTime();
        this.dnsServers = this.getDNSServers();
        this.dnsName = this.getDNSName();
        this.remoteSyslog = this.getRemoteSyslog();
        this.phoneHome = this.getPhoneHome();

        this.configurationHref = {
            route: 'management',
            params: { tab: 'settings' }
        };

        this.isEditServerModalVisible = ko.observable(false);

        loadServerTime(ko.unwrap(serverSecret));
    }

    getInfoSheet() {
        return [
            {
                label: 'IP Address',
                value: ko.pureComputed(
                    () => this.server().address
                )
            },
            {
                label: 'Hostname',
                value: ko.pureComputed(
                    () => this.server().hostname
                )
            },
            {
                label: 'Location Tag',
                value: ko.pureComputed(
                    () => this.server().location
                )
            },
            {
                label: 'Is Currently Master',
                value: ko.pureComputed(
                    () => this.isMaster() ? 'yes' : 'no'
                )
            }
        ];
    }

    getVersion() {
        const icon = ko.pureComputed(
            () => {
                if (!this.isConnected()) {
                    return icons.unavailable;
                }

                return this.issues().version ? icons.problem : icons.healthy;
            }
        );

        const tooltip = ko.pureComputed(
            () => {
                if (!this.isConnected()) {
                    return '';
                }

                return {
                    text: this.issues().version || 'Synced with master',
                    align: 'start'
                };
            }
        );

        const text = ko.pureComputed(
            () => this.server().version
        );

        return { icon, tooltip, text };
    }

    getServerTime() {
        const icon = ko.pureComputed(
            () => {
                if (!this.isConnected()) {
                    return icons.unavailable;
                }

                return this.issues().ntpServer ? icons.problem : icons.healthy;
            }
        );

        const tooltip = ko.pureComputed(
            () => {
                if (!this.isConnected()) {
                    return '';
                }

                return {
                    text: this.issues().ntpServer || 'Working Properly',
                    align: 'start'
                };
            }
        );

        const ntp = ko.pureComputed(
            () => this.server().ntp_server || 'Not configured'
        );

        const clock = ko.pureComputed(this.clock).extend({
            formatTime: 'DD MMM YYYY HH:mm:ss ([GMT]Z)'
        });

        return { icon, tooltip, clock, ntp };
    }

    getDNSServers() {
        const servers = ko.pureComputed(
            () => (this.server().dns_servers || []).filter(isDefined)
        );

        const icon = ko.pureComputed(
            () => {
                if (!this.isConnected() || servers().length == 0) {
                    return icons.unavailable;
                }

                return this.issues().dnsServers ? icons.problem : icons.healthy;
            }
        );

        const tooltip = ko.pureComputed(
            () => {
                if (!this.isConnected() || servers().length == 0) {
                    return '';
                }

                return {
                    text: this.issues().dnsServers || 'Reachable and working',
                    align: 'start'
                };
            }
        );

        const primary = ko.pureComputed(
            () => servers()[0] || 'Not Configured'
        );

        const secondary = ko.pureComputed(
            () => servers()[1] || 'Not Configured'
        );

        return { icon, tooltip, primary, secondary };
    }

    getDNSName() {
        const dnsName = ko.pureComputed(
            () => systemInfo() && !systemInfo().dns_name
        );

        const icon = ko.pureComputed(
            () => {
                if (!this.isConnected() || !dnsName()){
                    return icons.unavailable;
                }

                return this.issues().dnsName ? icons.problem : icons.healthy;
            }
        );

        const tooltip = ko.pureComputed(
            () => {
                if (!this.isConnected() || !dnsName()) {
                    return '';
                }

                return {
                    text: this.issues().dnsName || 'Resolvable to server\'s IP',
                    align: 'start'
                };
            }
        );

        const name = ko.pureComputed(
            () => (systemInfo() && systemInfo().dns_name) || 'Not configured'
        );

        return { icon, tooltip, name };
    }

    getRemoteSyslog() {
        const config = ko.pureComputed(
            () => (systemInfo() || {}).remote_syslog_config
        );

        const icon = ko.pureComputed(
            () => {
                if (!this.isConnected() || !config()) {
                    return icons.unavailable;
                }

                return this.issues().remoteSyslog ? icons.problem : icons.healthy;
            }
        );

        const tooltip = ko.pureComputed(
            () => {
                if (!this.isConnected() || !config()) {
                    return '';
                }

                return {
                    text: this.issues().remoteSyslog || 'Reachable and working',
                    align: 'start'
                };
            }
        );

        const text = ko.pureComputed(
            () => {
                if (!config()) {
                    return 'Not Configured';
                }

                const { protocol, address, port } = config();
                return `${protocol}://${address}:${port}`;
            }

        );

        return { icon, tooltip, text };
    }

    getPhoneHome() {
        const icon = ko.pureComputed(
            () => {
                if (!this.isConnected()) {
                    return icons.unavailable;
                }

                return this.issues().phoneHomeServer || this.issues().phoneHomeProxy ?
                    icons.problem :
                    icons.healthy;
            }
        );

        const tooltip = ko.pureComputed(
            () => {
                if (!this.isConnected()){
                    return '';
                }

                const { phoneHomeServer, phoneHomeProxy } = this.issues();
                const issues = [ phoneHomeServer, phoneHomeProxy ].filter(isDefined);
                return {
                    text: issues.length > 0 ? issues : 'Reachable and working',
                    align: 'start'
                };
            }
        );

        const proxy = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return '';
                }

                return systemInfo().phone_home_config.proxy_address || 'Not Configured';
            }
        );

        return { icon, tooltip, proxy };
    }

    showEditServerModal() {
        this.isEditServerModalVisible(true);
    }

    hideEditServerModal() {
        this.isEditServerModalVisible(false);
    }
}

export default {
    viewModel: ServerDetailsFormViewModel,
    template: template
};

