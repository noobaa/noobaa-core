import template from './server-dns-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo, nameResolutionState } from 'model';
import { makeRange } from 'utils/all';
import { attemptResolveSystemName } from 'actions';
import { inputThrottle } from 'config';

const [ IP, DNS ] = makeRange(2);
const addressOptions = [
    { label: 'Use Server IP', value: IP },
    { label: 'Use DNS Name (recommended)', value: DNS }
];

class ServerDNSFormViewModel extends Disposable {
    constructor({ isCollapsed }) {
        super();

        this.isCollapsed = isCollapsed;

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
                rateLimit: {
                    timeout: inputThrottle,
                    method: 'notifyWhenChangesStop'
                }
            })
            .extend({
                required: {
                    onlyIf: this.usingDNS,
                    message: 'Please enter a DNS Name'
                },
                isDNSName: true,
                validation: {
                    async: true,
                    onlyIf: () => this.dnsName(),
                    validator: (name, _, callback) => {
                        attemptResolveSystemName(name);

                        nameResolutionState.once(
                            ({ valid }) => callback({
                                isValid: valid,
                                message: 'Cloud not resolve dns name'
                            })
                        );
                    }
                }
            });

        this.baseAddress = ko.pureComputed(
            () => this.usingIP() ? this.ipAddress() : this.dnsName()
        );

        this.errors = ko.validation.group([
            this.dnsName
        ]);

        this.isUpdateSystemNameModalVisible = ko.observable(false);
    }

    update() {
        if (this.errors.validatingCount() > 0 || this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
            this.isUpdateSystemNameModalVisible(true);
        }
    }

    hideUpdateSystemNameModal() {
        this.isUpdateSystemNameModalVisible(false);
    }
}

export default {
    viewModel: ServerDNSFormViewModel,
    template: template
};
