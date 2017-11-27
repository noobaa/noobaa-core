/* Copyright (C) 2016 NooBaa */

import template from './edit-server-dns-settings-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { updateServerDNSSettings } from 'actions';

const searchDomainTooltip = 'If configured, search domains will be added to the fully qualified domain names when trying to resolve host names';

class EditServerDNSSettingsModalViewModel extends BaseViewModel {
    constructor({ serverSecret, onClose }) {
        super();

        this.serverSecret = ko.unwrap(serverSecret);
        this.close = onClose;

        const server = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0].servers.find(
                server => server.secret === this.serverSecret
            )
        );

        const dnsServers = ko.pureComputed(
            () => server() ? server().dns_servers : []
        );

        this.searchDomains = ko.observableWithDefault(
            () => (server() ? server().search_domains : []).join(',')
        );

        this.primaryDNS = ko.observableWithDefault(
                () => dnsServers()[0]
            )
            .extend({ isIP: true });

        this.secondaryDNS = ko.observableWithDefault(
                () => dnsServers()[1]
            )
            .extend({
                isIP: {
                    onlyIf: this.primaryDNS
                }
            });

        this.hasNoPrimaryDNS = ko.pureComputed(
            () => !this.primaryDNS()
        );

        this.errors = ko.validation.group(this);
        this.searchDomainTooltip = searchDomainTooltip;
    }

    update() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
            if(!this.primaryDNS()) {
                updateServerDNSSettings(this.serverSecret, '', '', []);
            } else {
                const searchDomains = (this.searchDomains() || '')
                        .split(',')
                        .map(domain => domain.trim())
                        .filter(Boolean);

                updateServerDNSSettings(this.serverSecret, this.primaryDNS(), this.secondaryDNS(), searchDomains);
            }

            this.close();
        }
    }

    cancel() {
        this.close();
    }
}

export default {
    viewModel: EditServerDNSSettingsModalViewModel,
    template: template
};
