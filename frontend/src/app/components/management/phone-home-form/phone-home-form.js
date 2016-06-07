import template from './phone-home-form.html';
import ko from 'knockout';
import { systemInfo } from 'model';
import { updatePhoneHomeConfig } from 'actions';

class PhoneHomeFormViewModel {
    constructor() {
        this.expanded = ko.observable(false);

        let config = ko.pureComputed(
            () => systemInfo() && systemInfo().phoneHomeConfig
        );

        this.proxyAddress = ko.pureComputed(
            () => config() && config().proxy_address
        );

        this.proxyAddressText = ko.pureComputed(
            () => this.proxyAddress() || 'Not set'
        );

        this.usingProxy = ko.observableWithDefault(
            () => !!this.proxyAddress()
        );

        this.proxyIPOrDNS = ko.observableWithDefault(
            () => {
                let addr = this.proxyAddress();
                return addr && addr.substring(
                    addr.indexOf('://') + 3, 
                    addr.lastIndexOf(':')
                );
            }
        )
            .extend({
                required: {
                    onlyIf: this.usingProxy,
                    message: 'Please enter an IP or DNS name' 
                },
                isIPOrDNSName: true
            });

        let portValMessage = 'Please provide a port number between 1 and 65535';
        this.proxyPort = ko.observableWithDefault(
            () => {
                let addr = this.proxyAddress();
                return addr && addr.substr(addr.lastIndexOf(':') + 1);
            }
        )
            .extend({
                required: { onlyIf: this.usingProxy, message: portValMessage },
                min: { params: 1, message: portValMessage },
                max: { params: 65535, message: portValMessage }
            });

        this.errors = ko.validation.group([
            this.proxyIPOrDNS,
            this.proxyPort
        ]);
    }

    applyChanges() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
            let proxyAddress = this.usingProxy() ? 
                `http://${this.proxyIPOrDNS()}:${this.proxyPort()}` : 
                null;

            updatePhoneHomeConfig(proxyAddress);
        }
    }
}

export default {
    viewModel: PhoneHomeFormViewModel,
    template: template
}