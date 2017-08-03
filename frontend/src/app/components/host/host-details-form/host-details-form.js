/* Copyright (C) 2016 NooBaa */

import template from './host-details-form.html';
import Observer from 'observer';
import { state$ } from 'state';
import { deepFreeze, mapValues } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import { randomString } from 'utils/string-utils';
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

function _getServicesString({ services }) {
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

function _getMemoryInfo({ mode, memory }) {
    const hasWarning = mode === 'MEMORY_PRESSURE';
    const usage = `${formatSize(memory.used)} of ${formatSize(memory.total)}`;
    const css = hasWarning ? 'warning' : '';
    const utilization = `${numeral(memory.used/memory.total).format('%')} utilization`;
    const tooltip = memoryPressureTooltip;

    return { usage, utilization, css, hasWarning, tooltip };
}

class HostDetailsFormViewModel extends Observer {
    constructor({ name }) {
        super();

        this.hostLoaded = ko.observable(false);
        this.name = ko.observable(randomString());
        this.version = ko.observable(randomString());
        this.services = ko.observable(randomString());
        this.lastCommunication = ko.observable(randomString());
        this.ip = ko.observable(randomString());
        this.protocol = ko.observable(randomString());
        this.portRange = ko.observable(randomString());
        this.endpoint = ko.observable(randomString());
        this.rtt = ko.observable(randomString());
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

        const { name, version, lastCommunication, ip, protocol,
            ports, rtt, hostname, upTime, os, cpus } = host;

        this.hostLoaded(true);
        this.name(name);
        this.version(version);
        this.services(_getServicesString(host));
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
        this.memory(_getMemoryInfo(host));
    }
}

export default {
    viewModel: HostDetailsFormViewModel,
    template: template
};
