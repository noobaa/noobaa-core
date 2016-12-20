import template from './server-dns-settings-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { updateServerDNSSettings } from 'actions';
import { deepFreeze } from 'utils/core-utils';

const warnings = deepFreeze({
    master: `Updating the master's DNS settings will cause a restart of the NooBaa
             service and may cause a change in the cluster master server.
             This could take a few moments and you might be automatically logged
             out from management console`,

    server: `Updating the server's DNS settings will cause a restart of the NooBaa
             service. This could take a few moments and you might be automatically
             logged out from the management console`
});

class ServerDNSSettingsModalViewModel extends Disposable {
    constructor({ serverSecret, onClose }) {
        super();

        this.serverSecret = ko.unwrap(serverSecret);
        this.onClose = onClose;

        const server = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0].servers.find(
                server => server.secret === this.serverSecret
            )
        );

        const dnsServers = ko.pureComputed(
            () => server() ? server().dns_servers : []
        );

        this.warning = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';
                }

                const isMaster = server().secret === systemInfo().cluster.master_secret;
                return isMaster ? warnings.master : warnings.server;
            }
        );

        this.primaryDNS = ko.observableWithDefault(
            () => dnsServers()[0]
        )
            .extend({
                required: {
                    onlyIf: () => this.secondaryDNS(),
                    message: 'A primary DNS must be configured prior to a secondary DNS'
                },
                isIP: true
            });

        this.secondaryDNS = ko.observableWithDefault(
            () => dnsServers()[1]
        )
            .extend({ isIP: true });

        this.updating = ko.observable(false);
        this.errors = ko.validation.group(this);
    }

    update() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            updateServerDNSSettings(
                this.serverSecret, this.primaryDNS(), this.secondaryDNS()
            );

            this.updating(true);
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: ServerDNSSettingsModalViewModel,
    template: template
};
