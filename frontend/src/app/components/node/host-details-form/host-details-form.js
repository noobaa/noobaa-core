/* Copyright (C) 2016 NooBaa */

import template from './host-details-form.html';
import Observer from 'observer';
import { state$ } from 'state';
import { deepFreeze, mapValues } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';

const protocolMapping = deepFreeze({
    UNKNOWN: 'Unknown',
    TCP: 'TCP',
    UDP: 'UDP <span class="warning">(Not optimized for performance)</span>'
});

const memoryPressureTooltip = {
    text: 'High Memory Pressure',
    position: 'above'
};

function _getServiceString({ services }) {
    const { storage, gateway } = mapValues(
        services,
        service => service.mode !== 'DECOMMISSIONED'
    );

    if (storage && gateway) {
        return 'Used for storage and as a S3 gateway';

    } else if (storage) {
        return 'Used for storage';

    } else if (gateway) {
        return 'Used as a S3 gateway';

    } else {
        return 'All services are disabled';
    }
}

class HostDetailsFormViewModel extends Observer {
    constructor({ name }) {
        super();

        this.name = ko.observable();
        this.version = ko.observable();
        this.services = ko.observable();
        this.lastCommunication = ko.observable();
        this.ip = ko.observable();
        this.protocol = ko.observable();
        this.portRange = ko.observable();
        this.endpoint = ko.observable();
        this.rtt = ko.observable();
        this.daemonInfo = [
            {
                label: 'Node Name',
                value: this.name
            },
            {
                label: 'Installed Version',
                value: this.version
            },
            {
                label: 'Services',
                value: this.services
            },
            {
                label: 'Last Communication',
                value: this.lastCommunication
            },
            {
                label: 'Communication IP',
                value: this.ip
            },
            {
                label: 'Peer to Peer Connectivity',
                value: this.protocol
            },
            {
                label: 'Port Range',
                value: this.portRange
            },
            {
                label: 'Server Endpoint',
                value: this.endpoint
            },
            {
                label: 'Round Trip Time',
                value: this.rtt
            }
        ];

        this.hostname = ko.observable();
        this.upTime = ko.observable();
        this.os = ko.observable();
        this.cpus = ko.observable();
        this.memory = ko.observable();
        this.systemInfo = [
            {
                label: 'Host Name',
                value: this.hostname
            },
            {
                label: 'Up Time',
                value: this.upTime
            },
            {
                label: 'OS Type',
                value: this.os
            },
            {
                label: 'CPUs',
                value: this.cpus
            },
            {
                label: 'Memory',
                value: this.memory,
                template: 'memory'
            }
        ];

        this.observe(state$.get('hosts', 'items', ko.unwrap(name)), this.onHost);
    }

    onHost(host) {
        if (!host) return;

        const { name, version, lastCommunication, ip, memory, protocol,
            ports, rtt, hostname, upTime, os, cpus, mode } = host;

        this.name(name);
        this.version(version);
        this.services(_getServiceString(host));
        this.lastCommunication(moment(lastCommunication).fromNow() + ' (TIMEZONE: ???)');
        this.ip(ip);
        this.protocol(protocolMapping[protocol]);
        this.portRange(`${ports.start} - ${ports.end} ???`);
        this.endpoint('???');
        this.rtt(`${rtt.toFixed(2)}ms`);
        this.hostname(hostname);
        this.upTime(moment(upTime).fromNow(true) + ' (TIMEZONE: ???)');
        this.os(os);
        this.cpus(`${cpus.length} | ???`);

        { // Update memory observable
            const hasWarning = mode !== 'MEMORY_PRESSURE';
            const usage = `${formatSize(memory.used)} of ${formatSize(memory.total)}`;
            const css = hasWarning ? 'warning' : '';
            const utilization = `${numeral(memory.used/memory.total).format('%')} utilization`;
            const tooltip = memoryPressureTooltip

            this.memory({ usage, utilization, css, hasWarning, tooltip });
        }
    }
}

export default {
    viewModel: HostDetailsFormViewModel,
    template: template
};
