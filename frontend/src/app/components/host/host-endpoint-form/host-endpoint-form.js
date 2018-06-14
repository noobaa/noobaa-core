/* Copyright (C) 2016 NooBaa */

import template from './host-endpoint-form.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { deepFreeze } from 'utils/core-utils';
import { getEndpointServiceStateIcon } from 'utils/host-utils';
import { formatSize } from 'utils/size-utils';
import { timeShortFormat } from 'config';
import ko from 'knockout';
import moment from 'moment';
import { getMany } from 'rx-extensions';
import {
    toggleHostServices,
    openDisableHostEndpointWarningModal,
    openDisableHostLastServiceWarningModal
} from 'action-creators';

const operationsDisabledTooltip = deepFreeze({
    align: 'end',
    text: 'This operation is not available during node’s deletion'
});

class HostEndpointFormViewModel extends Observer {
    hostName = '';
    hostLoaded = ko.observable();
    isDisabled = ko.observable();
    isToggleEndpointDisabled = ko.observable();
    toggleEndpointTooltip = ko.observable();
    toggleEndpointButtonText = ko.observable();
    state = ko.observable();
    wasUsed = false;
    latestWrites = ko.observable();
    latestReads = ko.observable();
    restEndpoint = ko.observable();
    restEndpointPublic = ko.observable();
    details = [
        {
            template: 'state',
            label: 'Endpoint State',
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
        },
        {
            label: 'REST Enpoint for public networks',
            value: this.restEndpointPublic,
            visible: this.restEndpointPublic,
            disabled: this.isDisabled
        }
    ];

    constructor({ name }) {
        super();

        this.hostName = ko.unwrap(name);

        this.observe(
            state$.pipe(
                getMany(
                    ['hosts', 'items', this.hostName],
                    ['topology', 'servers']
                )
            ),
            this.onHost
        );
    }

    onHost([ host, servers ]) {
        if (!host || !servers) {
            this.isDisabled(false);
            this.isToggleEndpointDisabled(true);
            this.toggleEndpointButtonText('Disable S3 Endpoint');
            return;
        }

        const { storage, endpoint } = host.services;
        const { mode, usage } = endpoint;
        const isDisabled = mode === 'DECOMMISSIONED';
        const isLastService = storage.mode === 'DECOMMISSIONED' || storage.mode === 'DECOMMISSIONING';
        const isHostBeingDeleted = host.mode === 'DELETING';
        const toggleEndpointTooltip = isHostBeingDeleted ? operationsDisabledTooltip : '';
        const toggleEndpointButtonText = `${isDisabled ? 'Enable' : 'Disable'} S3 Endpoint`;

        this.isToggleEndpointDisabled(isHostBeingDeleted);
        this.toggleEndpointTooltip(toggleEndpointTooltip);
        this.toggleEndpointButtonText(toggleEndpointButtonText);
        this.state(getEndpointServiceStateIcon(host));
        this.isDisabled(isDisabled);
        this.restEndpoint(host.ip);
        this.restEndpointPublic(host.publicIp || '');
        this.hostLoaded(true);
        this.isLastService = isLastService;


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
            this.wasUsed = Boolean(usage.lastWrite || usage.lastRead);

        } else {
            this.wasUsed = false;
        }
    }

    onToggleEndpoint() {
        const { hostName, isDisabled, wasUsed, isLastService } = this;

        if (isDisabled()) {
            action$.next(toggleHostServices(hostName, { endpoint: true }));

        } else if (wasUsed) {
            action$.next(openDisableHostEndpointWarningModal(hostName, isLastService));

        } else if (isLastService) {
            action$.next(openDisableHostLastServiceWarningModal(hostName, 'endpoint'));

        } else {
            action$.next(toggleHostServices(this.hostName, { endpoint: false }));
        }
    }
}

export default {
    viewModel: HostEndpointFormViewModel,
    template: template
};
