import template from './server-dns-form.html';
import ko from 'knockout';
import { systemInfo } from 'model';
import { makeRange } from 'utils';
import { updateHostname } from 'actions';

const [ IP, DNS ] = makeRange(2);
const addressOptions = [
    { label: 'Use Server IP', value: IP },
    { label: 'Use DNS Name (recommended)', value: DNS }
];

class ServerDNSFormViewModel {
    constructor() {
        this.expanded = ko.observable(false);
        this.addressOptions = addressOptions;

        this.addressType = ko.observableWithDefault(
            () => systemInfo() && (!systemInfo().dns_name ? IP : DNS)
        );

        this.usingIP = this.addressType.is(IP);
        this.usingDNS = this.addressType.is(DNS);

        this.ipAddress = ko.pureComputed(
            ()=> systemInfo() && systemInfo().ip_address
        );

        this.dnsName = ko.observableWithDefault(
            () => systemInfo() && systemInfo().dns_name
        )
            .extend({
                required: {
                    onlyIf: this.usingDNS,
                    message: 'Please enter a DNS Name'
                },
                isDNSName: true
            });

        this.baseAddress = ko.pureComputed(
            () => this.usingIP() ? this.ipAddress() : this.dnsName()
        );

        this.errors = ko.validation.group([
            this.dnsName
        ]);
    }

    applyChanges() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            updateHostname(this.baseAddress(), systemInfo().ssl_port, true);
        }
    }
}

export default {
    viewModel: ServerDNSFormViewModel,
    template: template
};
