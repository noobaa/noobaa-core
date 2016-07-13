import template from './server-dns-settings-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { updateServerDNSSettings } from 'actions';

class ServerDNSSettingsModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;

        let server = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0].servers[0]
        );

        let dnsServers = ko.pureComputed(
            () => server() && server().dns_servers
        );

        this.secret = ko.pureComputed(
            () => server() && server().secret
        );

        this.primaryDNS = ko.observableWithDefault(
            () => dnsServers[0]
        )
            .extend({
                required: { onlyIf: () => this.secondaryDNS() },
                isIPOrDNSName: true
            });

        this.secondaryDNS = ko.observableWithDefault(
            () => dnsServers[1]
        )
            .extend({ isIPOrDNSName: true });

        this.errors = ko.validation.group(this);
    }

    save() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            updateServerDNSSettings(
                this.secret(),
                this.primaryDNS(),
                this.secondaryDNS()
            );

            this.onClose();
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
