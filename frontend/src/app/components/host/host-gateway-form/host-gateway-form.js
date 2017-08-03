/* Copyright (C) 2016 NooBaa */

import template from './host-gateway-form.html';
import Observer from 'observer';
import { state$ } from 'state';
import ko from 'knockout';

class HostGatewayFormViewModel extends Observer {
    constructor({ name }) {
        super();

        this.isDisabled = ko.observable();
        this.toggleGatewayButtonText = ko.observable('Disable S3 Gateway');
        this.state = ko.observable('???');
        this.lastWeekWrites = ko.observable('???');
        this.lastWeekReads = ko.observable('???');
        this.details = [
            {
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

        this.observe(state$.get('hosts', 'items', ko.unwrap(name)), this.onHost);
    }

    onHost(host) {
        if (!host) return;

        const { mode } = host.services.gateway;
        this.isDisabled(mode === 'DECOMMISSIONED');
    }

    onToggleGateway() {

    }
}

export default {
    viewModel: HostGatewayFormViewModel,
    template: template
};
