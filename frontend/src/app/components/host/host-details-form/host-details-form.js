/* Copyright (C) 2016 NooBaa */

import template from './host-details-form.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { deepFreeze, mapValues, flatMap } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import { getHostDisplayName } from 'utils/host-utils';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import { openSetNodeAsTrustedModal } from 'action-creators';

const protocolMapping = deepFreeze({
    UNKNOWN: 'Unknown',
    TCP: 'TCP',
    UDP: 'UDP <span class="warning">(Not optimized for performance)</span>'
});

const memoryPressureTooltip = {
    text: 'High Memory Pressure',
    position: 'above'
};

function _getPortRageString({ ports }) {
    if (!ports) {
        return 'Initializing';
    }

    const { min, max } = ports;
    return  min === max ? min : `${min} - ${max}`;
}

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
        this.isRetrustButtonVisible = ko.observable();
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
                value: this.cpus,
                template: 'cpus'
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
        if (!host) {
            this.isRetrustButtonVisible(false);
            return;
        }

        const { name, version, lastCommunication, ip, protocol,
            endpoint, rtt, hostname, upTime, os, cpus, services } = host;

        const cpusInfo = {
            count: cpus.units.length,
            utilization: `${numeral(cpus.usage).format('%')} utilization`
        };

        if(!host.trusted) {
            this.untrustedReasons = flatMap(
                services.storage.nodes,
                node => node.untrusted.map(events => ({ events, drive: node.mount}))
            );
        }

        this.host = name;
        this.hostLoaded(true);
        this.name(getHostDisplayName(name));
        this.version(version);
        this.services(_getServicesString(host));
        this.lastCommunication(moment(lastCommunication).fromNow());
        this.ip(ip);
        this.protocol(protocolMapping[protocol]);
        this.portRange(_getPortRageString(host));
        this.endpoint(endpoint);
        this.rtt(`${rtt.toFixed(2)}ms`);
        this.hostname(hostname);
        this.upTime(moment(upTime).fromNow(true));
        this.os(os);
        this.cpus(cpusInfo);
        this.memory(_getMemoryInfo(host));
        this.isRetrustButtonVisible(!host.trusted);
    }

    onRetrust() {
        action$.onNext(openSetNodeAsTrustedModal(this.host, this.untrustedReasons));
    }
}

export default {
    viewModel: HostDetailsFormViewModel,
    template: template
};
