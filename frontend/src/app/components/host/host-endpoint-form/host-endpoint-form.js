/* Copyright (C) 2016 NooBaa */

import template from './host-endpoint-form.html';
import ConnectableViewModel from 'components/connectable';
import { getEndpointServiceStateIcon } from 'utils/host-utils';
import { formatSize } from 'utils/size-utils';
import { unassignedRegionText } from 'utils/resource-utils';
import { timeShortFormat } from 'config';
import ko from 'knockout';
import moment from 'moment';

class HostEndpointFormViewModel extends ConnectableViewModel {
    hostName = '';
    wasUsed = false;
    isLastService = false;
    dataReady = ko.observable();
    isDisabled = ko.observable();
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
        const { topology, hosts, hostPools = {} } = state;
        const host = hosts.items[params.name];
        const master =  topology && Object.values(topology.servers)
            .find(server => server.isMaster);

        return [
            host,
            host && hostPools[host.pool],
            master && master.timezone
        ];
    }

    mapStateToProps(host, pool, timezone) {
        if (!host || !pool || !timezone) {
            ko.assignToProps(this, {
                dataReady: false,
                isDisabled: true
            });

        } else {
            const { storage, endpoint } = host.services;
            const { mode, usage } = endpoint;
            const isDisabled = mode === 'DECOMMISSIONED';
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
}

export default {
    viewModel: HostEndpointFormViewModel,
    template: template
};
