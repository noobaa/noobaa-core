import template from './server-dns-settings-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';

class ServerDnsSettingsFormViewModel extends Disposable{
    constructor() {
        super();

        this.expanded = ko.observable(false);

        let cluster = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster
        );

        let server = ko.pureComputed(
            () => cluster() && cluster().shards[0].servers.find(
                server => server.secret === cluster().master_secret
            )
        );

        this.serverSecret = ko.pureComputed(
            () => server() && server().secret
        );

        let dnsServers = ko.pureComputed(
            () => server() ? server().dns_servers : []
        );

        this.primaryDNS = ko.observableWithDefault(
            () => dnsServers()[0]
        )
            .extend({
                required: {
                    onlyIf: () => this.secondaryDNS(),
                    message: 'A primary DNS must be configured prior to a secondary DNS'
                },
                isIPOrDNSName: true
            });

        this.secondaryDNS = ko.observableWithDefault(
            () => dnsServers()[1]
        )
            .extend({
                isIPOrDNSName: true
            });

        this.errors = ko.validation.group(this);

        this.isUpdateServerDNSSettingsModelVisible = ko.observable();
    }

    update() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            this.isUpdateServerDNSSettingsModelVisible(true);
        }
    }

    hideUpdateDServerDNSSettingsModal() {
        this.isUpdateServerDNSSettingsModelVisible(false);
    }
}

export default {
    viewModel: ServerDnsSettingsFormViewModel,
    template: template
};
