import template from './remote-syslog-form.html';
import ko from 'knockout';
import { systemInfo } from 'model';
import { enableRemoteSyslog, disableRemoteSyslog } from 'actions';
import { deepFreeze } from 'utils';

const protocols = deepFreeze({
    UDP: { defaultPort: 5014 },
    TCP: { defaultPort: 601 }
});

const defaultProtocol = 'UDP';
const portValMessage = 'Please enter a port number between 1 and 65535';

class RemoteSyslogFormViewModel {
    constructor() {
        this.expanded = ko.observable(false);

        let config = ko.pureComputed(
            () => systemInfo() && systemInfo().remote_syslog_config
        );

        this.enabled = ko.observableWithDefault(
            () => !!config()
        );

        this.protocol = ko.observableWithDefault(
            () => config() ? config().protocol : defaultProtocol
        );

        this.address = ko.observableWithDefault(
            () => config() && config().address
        )
            .extend({
                required: {
                    onlyIf: this.enabled,
                    message: 'Please enter an IP or DNS name'
                },
                isIPOrDNSName: true
            });

        this.port = ko.observableWithDefault(
            () => config() ? config().port : protocols[this.protocol()].defaultPort
        )
            .extend({
                required: { onlyIf: this.enabled, message: portValMessage },
                min: { params: 1, message: portValMessage },
                max: { params: 65535, message: portValMessage }
            });

        this.protocolOptions = Object.keys(protocols).map(
            key => ({ label: key, value: key })
        );

        this.summaryText = ko.pureComputed(
            () => this.enabled() ?
                `${this.protocol().toLowerCase()}://${this.address()}:${this.port()}` :
                'No set'
        );

        this.errors = ko.validation.group([
            this.address,
            this.port
        ]);
    }

    applyChanges() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else if (this.enabled()) {
            enableRemoteSyslog(this.protocol(), this.address(), this.port());
        } else {
            disableRemoteSyslog();
        }
    }
}

export default {
    viewModel: RemoteSyslogFormViewModel,
    template: template
};
