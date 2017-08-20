/* Copyright (C) 2016 NooBaa */

import template from './host-gateway-form.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { toggleHostServices, openDisableHostGatewayWarningModal } from 'action-creators';
import { getGatewayServiceStateIcon } from 'utils/host-utils';
import { formatSize } from 'utils/size-utils';
import { timeShortFormat } from 'config';
import ko from 'knockout';
import moment from 'moment';

class HostGatewayFormViewModel extends Observer {
    constructor({ name }) {
        super();

        this.hostName = ko.unwrap(name);
        this.hostLoaded = ko.observable(false);
        this.isDisabled = ko.observable();
        this.toggleGatewayButtonText = ko.observable();
        this.state = ko.observable();
        this.wasUsed = ko.observable();
        this.latestWrites = ko.observable();
        this.latestReads = ko.observable();
        this.restEndpoint = ko.observable();
        this.details = [
            {
                template: 'state',
                label: 'Gateway State',
                value: this.state
            },
            {
                label: 'Data Written in Last 7 Days',
                value: this.latestWrites,
                disabled: this.isDisabled,
                template: 'ioUsage'
            },
            {
                label: 'Data read in Last 7 Days',
                value: this.latestReads,
                disabled: this.isDisabled,
                template: 'ioUsage'
            },
            {
                label: 'REST Endpoint',
                value: this.restEndpoint,
                disabled: this.isDisabled
            }
        ];

        this.observe(
            state$.getMany(
                ['hosts', 'items', this.hostName],
                ['topology', 'servers']
            ),
            this.onHost
        );
    }

    onHost([ host, servers ]) {
        if (!host) {
            this.isDisabled(false);
            this.toggleGatewayButtonText('Disable S3 Gateway');
            return;
        }

        const { gateway }  = host.services;
        const { mode, usage } = gateway;
        const gatewayDisabled = mode === 'DECOMMISSIONED';

        this.toggleGatewayButtonText(`${gatewayDisabled ? 'Enable' : 'Disable'} S3 Gateway`);
        this.state(getGatewayServiceStateIcon(gateway));
        this.isDisabled(gatewayDisabled);
        this.restEndpoint(host.ip);
        this.hostLoaded(true);


        if (usage) {
            const { timezone } = Object.values(servers).find(server => server.isMaster);
            this.latestWrites({
                usage: formatSize(usage.last7Days.bytesWritten),
                lastIO: usage.lastWrite && moment.tz(usage.lastWrite, timezone).format(timeShortFormat)
            });
            this.latestReads({
                usage: formatSize(usage.last7Days.bytesRead),
                lastIO: usage.lastRead && moment.tz(usage.lastRead, timezone).format(timeShortFormat)
            });
            this.wasUsed(Boolean(usage.lastWrite || usage.lastRead));

        } else {
            this.wasUsed(false);
        }
    }

    onToggleGateway() {
        const action = this.wasUsed() ?
            openDisableHostGatewayWarningModal(this.hostName) :
            toggleHostServices(this.hostName, { gateway: this.isDisabled() });

        action$.onNext(action);
    }
}

export default {
    viewModel: HostGatewayFormViewModel,
    template: template
};
