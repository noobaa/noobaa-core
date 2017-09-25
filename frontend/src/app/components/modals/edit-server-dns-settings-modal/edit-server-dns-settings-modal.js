/* Copyright (C) 2016 NooBaa */

import template from './edit-server-dns-settings-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { updateServerDNSSettings } from 'actions';
import { deepFreeze } from 'utils/core-utils';
import { action$ } from 'state';
import { lockModal } from 'action-creators';

const warnings = deepFreeze({
    master: `Updating the master's DNS settings will cause a restart of the NooBaa
             service and may cause a change in the cluster master server.
             This could take a few moments and you might be automatically logged
             out from management console`,

    server: `Updating the server's DNS settings will cause a restart of the NooBaa
             service. This could take a few moments and you might be automatically
             logged out from the management console`
});

const searchDomainTooltip = 'If configured, search domains will be added to the fully qualified domain names when trying to resolve host names';

class EditServerDNSSettingsModalViewModel extends BaseViewModel {
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

        this.searchDomains = ko.observableWithDefault(
            () => (server() ? server().search_domains : []).join(',')
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
            .extend({ isIP: true });

        this.secondaryDNS = ko.observableWithDefault(
                () => dnsServers()[1]
            )
            .extend({
                isIP: {
                    onlyIf: this.primaryDNS
                }
            });

        this.isUpdatingOrPrimaryDNS = ko.pureComputed(
            () => !this.primaryDNS() || this.isUpdating()
        );

        this.isUpdating = ko.observable(false);
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

            action$.onNext(lockModal());
            this.isUpdating(true);
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: EditServerDNSSettingsModalViewModel,
    template: template
};
