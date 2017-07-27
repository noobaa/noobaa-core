/* Copyright (C) 2016 NooBaa */

import template from './server-details-form.html';
import BaseViewModel from 'components/base-view-model';
import { systemInfo, serverTime } from 'model';
import { deepFreeze, isDefined} from 'utils/core-utils';
import { getServerIssues } from 'utils/cluster-utils';
import { formatSize } from 'utils/size-utils';
import { loadServerTime } from 'actions';
import { timeLongFormat } from 'config';
import ko from 'knockout';
import { action$ } from 'state';
import { openEditServerDetailsModal } from 'action-creators';
import { aggregateStorage } from 'utils/storage-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';

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

const requirementsMarker = (message) => `<span class="remark warning">&nbsp; * ${message ? message : ''}</span>`;
const hyperlink = (uri, title) => `<a class="link" href="${uri}">${title}</a>`;

class ServerDetailsFormViewModel extends BaseViewModel {
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
            () => {
                if (!systemInfo()) {
                    return {};
                }

                const { version, cluster } = systemInfo();
                return getServerIssues(this.server(), version, cluster.min_requirements);
            }
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

        const minRequirements = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.min_requirements
        );

        this.notEnoughMemory = ko.pureComputed(
            () => {
                const { memory } = this.server() || {};
                if (!memory) {
                    return false;
                }

                return memory.total < minRequirements().ram;
            }
        );

        this.notEnoughStorage = ko.pureComputed(
            () => {
                const { storage } = this.server() || {};
                if (!storage) {
                    return false;
                }

                return storage.total < minRequirements().storage;
            }
        );

        this.notEnoughCpus = ko.pureComputed(
            () => {
                const { cpus } = this.server() || {};
                if (!cpus) {
                    return false;
                }

                return cpus.count < minRequirements().cpu_count;
            }
        );

        this.isBelowMinRequirements = ko.pureComputed(
            () => this.notEnoughMemory() ||
                this.notEnoughStorage() ||
                this.notEnoughCpus()
        );


        this.systemName = ko.pureComputed(
            () => systemInfo() && systemInfo().name
        );

        this.internalStorage = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return '';
                }

                const { pools } = systemInfo();
                const internalStorage = aggregateStorage(
                    ...pools.filter(pool => pool.resource_type === 'INTERNAL').map(
                        resource => resource.storage
                    )
                );

                return internalStorage;
            }
        );

        const timezone = ko.pureComputed(() => this.server().timezone);
        this.infoSheet = this.getInfoSheet(minRequirements);
        this.version = this.getVersion();
        this.serverTime = this.getServerTime(timezone);
        this.dnsServers = this.getDNSServers();
        this.dnsName = this.getDNSName();
        this.remoteSyslog = this.getRemoteSyslog(timezone);
        this.phoneHome = this.getPhoneHome(timezone);

        this.configurationHref = {
            route: 'management',
            params: { tab: 'settings' }
        };

        loadServerTime(ko.unwrap(serverSecret));
    }

    getInfoSheet(minRequirements) {
        const address = ko.pureComputed(
            () => this.server().address
        );

        const hostname = ko.pureComputed(
            () => this.server().hostname
        );

        const locationTag = ko.pureComputed(
            () => this.server().location || 'Not Set'
        );

        const isMaster = ko.pureComputed(
            () => this.isMaster() ? 'yes' : 'no'
        );

        const totalMemory = ko.pureComputed(
            () => {
                const { memory } = this.server() || {};
                return memory ?
                    `${formatSize(memory.total)} ${this.notEnoughMemory() ?
                        requirementsMarker(`Minimum requirements: ${formatSize(minRequirements().ram)}`)  : ''}` :
                    '';
            }
        );

        const totalStorage = ko.pureComputed(
            () => {
                const { storage } = this.server() || {};
                return storage ?
                    `${formatSize(storage.total)} ${this.notEnoughStorage() ?
                        requirementsMarker(`Minimum requirements: ${formatSize(minRequirements().storage)}`) : ''}` :
                    '';
            }
        );

        const cpusCount = ko.pureComputed(
            () => {
                const { cpus } = this.server() || {};
                return cpus ?
                    `${cpus.count} CPUs ${this.notEnoughCpus() ?
                        requirementsMarker(`Minimum requirements: ${minRequirements().cpu_count} CPUs`) : ''}` :
                    '';
            }
        );

        const internalStorage = ko.pureComputed(
            () => {
                const storage = this.internalStorage();
                const system = this.systemName();

                if(!system) return '';
                const uri = realizeUri(routes.pools, { system, tab: 'internal'}, {});

                return storage.total ?
                    `using 
                     ${formatSize(storage.used)} of 
                     ${formatSize(storage.total)} (by buckets spillover) ${hyperlink(uri, 'See internal resource')}` :
                    '';
            }
        );

        return [
            {
                label: 'IP Address',
                value: address
            },
            {
                label: 'Hostname',
                value: hostname
            },
            {
                label: 'Location Tag',
                value: locationTag
            },
            {
                label: 'Is Currently Master',
                value: isMaster
            },
            {
                label: 'Total Memory',
                value: totalMemory
            },
            {
                label: 'Total Disk Size',
                value: totalStorage
            },
            {
                label: 'Number or CPUs',
                value: cpusCount
            },
            {
                label: 'Internal Storage Resource',
                value: internalStorage
            },
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

    getServerTime(timezone) {
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

        const clock = ko.pureComputed(
            () => this.clock() || undefined
        ).extend({
            formatTime: {
                format: timeLongFormat,
                timezone,
                notAvailableText: 'Not available'
            }
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
                if (!this.isConnected()) {
                    return '';
                }

                if (servers().length === 0) {
                    return 'Not configured';
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
            () => systemInfo() && systemInfo().dns_name
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
                if (!this.isConnected()) {
                    return '';
                }

                if (!dnsName()) {
                    return 'Not configured';
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

    getRemoteSyslog(timezone) {
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
                if (!this.isConnected()) {
                    return '';
                }

                if (!config()) {
                    return 'Not configured';
                }

                return {
                    text: this.issues().remoteSyslog || 'Reachable and working',
                    align: 'start'
                };
            }
        );

        const isConfigured = ko.pureComputed(() => Boolean(config()));

        const text = ko.pureComputed(
            () => {
                if (config()) {
                    const { protocol, address, port } = config();
                    return `${protocol}://${address}:${port}`;
                }
            }

        );

        const lastRSyslogSync = ko.pureComputed(
            () => {
                const { remote_syslog = {} } = this.server().services_status || {};
                const { test_time } = remote_syslog;
                return test_time && test_time * 1000;
            }
        ).extend({
            formatTime: {
                format: timeLongFormat,
                timezone,
                notAvailableText: 'Not Tested Yet'
            }
        });

        return { icon, tooltip, isConfigured, text, lastRSyslogSync};
    }

    getPhoneHome(timezone) {
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

        const lastPhoneHomeSync = ko.pureComputed(
            () => {
                const { phonehome_server = {} } = this.server().services_status || {};
                const { test_time } = phonehome_server;
                return test_time && test_time * 1000;
            }
        ).extend({
            formatTime: {
                format: timeLongFormat,
                timezone,
                notAvailableText: 'Not Synced Yet'
            }
        });

        return { icon, tooltip, proxy, lastPhoneHomeSync };
    }

    onEditServerDetails() {
        action$.onNext(openEditServerDetailsModal(this.secret));
    }
}

export default {
    viewModel: ServerDetailsFormViewModel,
    template: template
};

