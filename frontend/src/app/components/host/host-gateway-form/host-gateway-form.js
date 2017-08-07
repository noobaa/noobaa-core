/* Copyright (C) 2016 NooBaa */

import template from './host-gateway-form.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { toggleHostServices } from 'action-creators';
import { getGatewayServiceStateIcon } from 'utils/host-utils';
import ko from 'knockout';

class HostGatewayFormViewModel extends Observer {
    constructor({ name }) {
        super();

        this.hostName = ko.unwrap(name);
        this.hostLoaded = ko.observable(false);
        this.isDisabled = ko.observable();
        this.toggleGatewayButtonText = ko.observable();
        this.state = ko.observable();
        this.lastWeekWrites = ko.observable('???');
        this.lastWeekReads = ko.observable('???');
        this.details = [
            {
                template: 'state',
                label: 'Gateway State',
                value: this.state
            },
            {
                label: 'Last Week Data Writes',
                value: this.lastWeekWrites
            },
            {
                label: 'Last Week Data Reads',
                value: this.lastWeekReads
            }
        ];

        this.observe(state$.get('hosts', 'items', this.hostName), this.onHost);
    }

    onHost(host) {
        if (!host) {
            this.isDisabled(false);
            this.toggleGatewayButtonText('Disable S3 Gateway');
            return;
        }

        const { gateway }  = host.services;
        const gatewayDisabled = gateway.mode === 'DECOMMISSIONED';

        this.toggleGatewayButtonText(`${gatewayDisabled ? 'Enable' : 'Disable'} S3 Gateway`);
        this.state(getGatewayServiceStateIcon(gateway));
        this.isDisabled(gatewayDisabled);
        this.hostLoaded(true);
    }

    onToggleGateway() {
        action$.onNext(toggleHostServices(
            this.hostName,
            { gateway: !this.isDisabled() }
        ));
    }
}

export default {
    viewModel: HostGatewayFormViewModel,
    template: template
};
