/* Copyright (C) 2016 NooBaa */

import template from './host-endpoint-form.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze } from 'utils/core-utils';
import { getEndpointServiceStateIcon } from 'utils/host-utils';
import { formatSize } from 'utils/size-utils';
import { unassignedRegionText } from 'utils/resource-utils';
import { timeShortFormat } from 'config';
import ko from 'knockout';
import moment from 'moment';
import {
    toggleHostServices,
    openDisableHostEndpointWarningModal,
    openDisableHostLastServiceWarningModal
} from 'action-creators';

const operationsDisabledTooltip = deepFreeze({
    align: 'end',
    text: 'This operation is not available during node’s deletion'
});

class HostEndpointFormViewModel extends ConnectableViewModel {
    hostName = '';
    wasUsed = false;
    isLastService = false;
    dataReady = ko.observable();
    isDisabled = ko.observable();
    isToggleEndpointVisible = ko.observable();
    isToggleEndpointDisabled = ko.observable();
    toggleEndpointTooltip = ko.observable();
    toggleEndpointButtonText = ko.observable();
    details = [
        {
            template: 'state',
            label: 'Endpoint State',
            value: ko.observable()
        },
        {
            label: 'Data Written in Last 7 Days',
            value: ko.observable(),
            disabled: ko.observable(),
            template: 'ioUsage'
        },
        {
            label: 'Data read in Last 7 Days',
            value: ko.observable(),
            disabled: ko.observable(),
            template: 'ioUsage'
        },
        {
            label: 'Assigned region',
            value: ko.observable(),
            disabled: ko.observable()
        },
        {
            label: 'REST Endpoint',
            value: ko.observable(),
            disabled: ko.observable()
        },
        {
            label: 'REST Enpoint for public networks',
            value: ko.observable(),
            visible: ko.observable(),
            disabled: ko.observable()
        }
    ];

    selectState(state, params) {
        const { topology, hosts, hostPools = {}, platform } = state;
        const host = hosts.items[params.name];
        const master =  topology && Object.values(topology.servers)
            .find(server => server.isMaster);

        return [
            host,
            host && hostPools[host.pool],
            master && master.timezone,
            platform && platform.featureFlags.toggleEndpointAgent

        ];
    }

    mapStateToProps(host, pool, timezone, allowToggleEndpointAgent) {
        if (!host || !pool || !timezone) {
            ko.assignToProps(this, {
                dataReady: false,
                isDisabled: true,
                isToggleEndpointVisible: false,
                isToggleEndpointDisabled: true,
                toggleEndpointButtonText: 'Disable S3 Endpoint'
            });

        } else {
            const { storage, endpoint } = host.services;
            const { mode, usage } = endpoint;
            const isDisabled = mode === 'DECOMMISSIONED';
            const isHostBeingDeleted = host.mode === 'DELETING';
            const lastWrites = usage ? {
                usage: formatSize(usage.last7Days.bytesWritten),
                lastIO: usage.lastWrite && moment.tz(usage.lastWrite, timezone).format(timeShortFormat)
            } : null;
            const lastReads = usage ? {
                usage: formatSize(usage.last7Days.bytesRead),
                lastIO: usage.lastRead && moment.tz(usage.lastRead, timezone).format(timeShortFormat)
            } : null;

            ko.assignToProps(this, {
                dataReady: true,
                isDisabled: isDisabled,
                hostName: host.name,
                isLastService: storage.mode === 'DECOMMISSIONED' || storage.mode === 'DECOMMISSIONING',
                wasUsed: Boolean(usage && (usage.lastWrite || usage.lastRead)),
                isToggleEndpointVisible: allowToggleEndpointAgent,
                isToggleEndpointDisabled: isHostBeingDeleted,
                toggleEndpointTooltip: isHostBeingDeleted ? operationsDisabledTooltip : '',
                toggleEndpointButtonText: `${isDisabled ? 'Enable' : 'Disable'} S3 Endpoint`,
                details: [
                    {
                        value: getEndpointServiceStateIcon(host)
                    },
                    {
                        value: lastWrites,
                        disabled: isDisabled
                    },
                    {
                        value: lastReads,
                        disabled: isDisabled
                    },
                    {
                        value: pool.region || unassignedRegionText,
                        disabled: isDisabled
                    },
                    {
                        value: host.ip,
                        disabled: isDisabled
                    },
                    {
                        value: host.publicIp || '',
                        visible: Boolean(host.publicIp),
                        disabled: isDisabled
                    }
                ]
            });
        }
    }

    onToggleEndpoint() {
        const { hostName, isDisabled, wasUsed, isLastService } = this;

        if (isDisabled()) {
            this.dispatch(toggleHostServices(hostName, { endpoint: true }));

        } else if (wasUsed) {
            this.dispatch(openDisableHostEndpointWarningModal(hostName, isLastService));

        } else if (isLastService) {
            this.dispatch(openDisableHostLastServiceWarningModal(hostName, 'endpoint'));

        } else {
            this.dispatch(toggleHostServices(this.hostName, { endpoint: false }));
        }
    }
}

export default {
    viewModel: HostEndpointFormViewModel,
    template: template
};
