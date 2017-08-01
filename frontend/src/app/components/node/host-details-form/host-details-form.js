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

function _getCpuUtilization(host) {
    const count = host.cpus.length;
    return `<p>${count} | ???</p>`;
}

function _getMemoryUtilization(host) {
    const { mode, memory } = host;
    const used = formatSize(memory.used);
    const total = formatSize(memory.total);
    const ratio = memory.used / memory.total;
    const css = mode === 'MEMORY_PRESSURE' ? 'warning' : '';

    return `<p>
        ${used} of ${total} |
        <span class="${css}">${numeral(ratio).format('%')} utilization</span>
        <svg-icon params="name: notif-info"></svg-icon>
    </p>`;
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
                value: this.memory
            }
        ];

        this.observe(state$.get('hosts', 'items', ko.unwrap(name)), this.onHost);
    }

    onHost(host) {
        if (!host) return;

        const usedServices = mapValues(host.services, service => service.mode !== 'DECOMMISSIONED');
        const services = [
            'Used ',
            usedServices.storage ? 'for storage' : '',
            usedServices.gateway ? 'as gateway' : ''
        ].join('');


        this.name(host.name);
        this.version(host.version);
        this.services(services);
        this.lastCommunication(moment(host.lastCommunication).fromNow() + ' (TIMEZONE: ???)');
        this.ip(host.ip);
        this.protocol(protocolMapping[host.protocol]);
        this.portRange(`${host.ports.start} - ${host.ports.end} ???`);
        this.endpoint('???');
        this.rtt(`${host.rtt.toFixed(2)}ms`);
        this.hostname(host.hostname);
        this.upTime(moment(host.upTime).fromNow(true) + ' (TIMEZONE: ???)');
        this.os(host.os);
        this.cpus(_getCpuUtilization(host));
        this.memory(_getMemoryUtilization(host));
    }
}

export default {
    viewModel: HostDetailsFormViewModel,
    template: template
};
