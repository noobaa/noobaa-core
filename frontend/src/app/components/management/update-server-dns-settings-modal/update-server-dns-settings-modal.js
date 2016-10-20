import template from './update-server-dns-settings-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { updateServerDNSSettings } from 'actions';

class UpdateServerDnsSettingsModalViewModel extends Disposable {
    constructor({ onClose, serverSecret, primaryDNS, secondaryDNS  }) {
        super();

        this.onClose = onClose;
        this.serverSecret = serverSecret;
        this.primaryDNS = primaryDNS;
        this.secondaryDNS = secondaryDNS;

        this.updating = ko.observable(false);
    }

    update() {
        this.updating(true);

        updateServerDNSSettings(
            ko.unwrap(this.serverSecret),
            ko.unwrap(this.primaryDNS),
            ko.unwrap(this.secondaryDNS)
        );
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: UpdateServerDnsSettingsModalViewModel,
    template: template
};
