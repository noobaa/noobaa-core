/* Copyright (C) 2016 NooBaa */

import template from './remote-syslog-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { enableRemoteSyslog, disableRemoteSyslog } from 'actions';
import { deepFreeze } from 'utils/core-utils';

const protocols = deepFreeze({
    UDP: { defaultPort: 5014 },
    TCP: { defaultPort: 514 }
});

const defaultProtocol = 'UDP';
const portValMessage = 'Please enter a port number between 1 and 65535';

class RemoteSyslogFormViewModel extends BaseViewModel {
    constructor({ isCollapsed }) {
        super();

        this.isCollapsed = isCollapsed;

        let config = ko.pureComputed(
            () => systemInfo() && systemInfo().remote_syslog_config
        );

        this.enabled = ko.observableWithDefault(
            () => !!config()
        );

        this.isPortEnabled = ko.pureComputed(
            () => this.enabled() && this.protocol() !== 'TCP'
        );

        this.protocol = ko.observableWithDefault(
            () => config() ? config().protocol : defaultProtocol
        );
        this.protocol.subscribe(
            () => this.port(config() ? config().port : protocols[this.protocol()].defaultPort)
        );

        this.address = ko.observableWithDefault(
            () => config() && config().address
        )
            .extend({
                required: {
                    onlyIf: this.enabled,
                    message: 'Please enter an IP or DNS name'
                },
                isIPOrDNSName: {
                    onlyIf: this.enabled
                }
            });

        this.port = ko.observableWithDefault(
            () => config() ? config().port : protocols[this.protocol()].defaultPort
        )
            .extend({
                required: {
                    onlyIf: this.enabled,
                    message: portValMessage
                },
                min: {
                    onlyIf: this.enabled,
                    params: 1,
                    message: portValMessage
                },
                max: {
                    onlyIf: this.enabled,
                    params: 65535,
                    message: portValMessage
                }
            });

        this.protocolOptions = Object.keys(protocols).map(
            key => ({ label: key, value: key })
        );

        this.summaryText = ko.pureComputed(
            () => this.enabled() ?
                `${this.protocol().toLowerCase()}://${this.address()}:${this.port()}` :
                'Not set'
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
            enableRemoteSyslog(
                this.protocol(),
                this.address(),
                Number(this.port())
            );

        } else {
            disableRemoteSyslog();
        }
    }
}

export default {
    viewModel: RemoteSyslogFormViewModel,
    template: template
};
