/* Copyright (C) 2016 NooBaa */

import template from './host-details-form.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { mapValues, flatMap, decimalRound } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import { getHostDisplayName } from 'utils/host-utils';
import { get } from 'rx-extensions';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import { openSetNodeAsTrustedModal, openConfirmDeleteHostModal } from 'action-creators';

const portsBlockedTooltip = `Some ports might be blocked. Check the firewall settings
    and make sure that the ports range of 60100-60600 is open for inbound traffix.
    These ports are used to communicate between the storage nodes.`;
const errorLevel = 0.95;
const warningLevel = 0.8;

function _getCssByUsage(usage) {
    return true &&
        (usage > errorLevel && 'error') ||
        (usage > warningLevel && 'warning') ||
        '';
}

function _getTooltipByUsage(subject, used, usedByNoobaa, usedByOther) {
    const usageLevel = used > errorLevel ?
        'Very High' :
        (used > warningLevel) ? 'High' : '';
    const title = `${usageLevel} ${subject} Pressure`.trim();

    return {
        text: {
            title,
            list: [
                `NooBaa utilization: ${numeral(usedByNoobaa).format('%')}`,
                `Server local utilization: ${numeral(usedByOther).format('%')}`
            ]
        },
        position: 'after'
    };
}

function _getProtocol({ protocol }) {
    const text = protocol === 'UNKNOWN' ? 'Unknown protocol' : protocol;
    const warning = protocol === 'UDP';
    return { text, warning };
}

function _getPortRage({ mode, ports }) {
    const { min, max } = ports || {};
    const warning = mode === 'N2N_PORTS_BLOCKED';
    const text = ports ? (min === max ? min : `${min}-${max}`) : 'Initializing';
    const tooltip = portsBlockedTooltip;

    return { text, warning, tooltip };
}

function _getServicesString({ services }) {
    const { storage, endpoint } = mapValues(
        services,
        service => service.mode !== 'DECOMMISSIONED'
    );

    if (storage && endpoint) {
        return 'Used for storage and as a S3 endpoint';

    } else if (storage) {
        return 'Used for storage';

    } else if (endpoint) {
        return 'Used as a S3 endpoint';

    } else {
        return 'All services are disabled';
    }
}

function _getMemoryInfo({ memory, mode }) {
    const usedMemory = memory.usedByNoobaa + memory.usedByOther;
    const totalMemory = usedMemory + memory.free;
    const used = decimalRound(usedMemory/totalMemory, 2);
    const usedByNoobaa = (memory.usedByNoobaa/totalMemory).toFixed(2);
    const usedByOther = used - usedByNoobaa;
    const usage = `${formatSize(usedMemory)} of ${formatSize(totalMemory)}`;

    if (mode === 'OFFLINE') {
        const utilization = '';

        return { usage, utilization };
    } else {
        const utilization = `${numeral(used).format('%')} utilization`;
        const css = _getCssByUsage(used);
        const tooltip = _getTooltipByUsage('Memory', used,  usedByNoobaa, usedByOther);

        return { usage, utilization, css, tooltip };
    }
}

function _getCpusInfo({ cpus, mode }) {
    const used = decimalRound(cpus.usedByNoobaa + cpus.usedByOther, 2);
    const usedByNoobaa = cpus.usedByNoobaa.toFixed(2);
    const usedByOther = used - usedByNoobaa;
    const count = cpus.units.length;

    if (mode === 'OFFLINE') {
        const utilization = '';

        return { count, utilization };
    } else {
        const utilization = `${numeral(used).format('%')} utilization`;
        const css = _getCssByUsage(used);
        const tooltip = _getTooltipByUsage('CPU', used, usedByNoobaa, usedByOther);

        return {count, utilization, css, tooltip };
    }
}

class HostDetailsFormViewModel extends Observer {
    constructor({ name }) {
        super();

        this.hostLoaded = ko.observable(false);
        this.isDeleteButtonWorking = ko.observable();
        this.isRetrustButtonVisible = ko.observable();

        // Daemon information observables.
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
                value: this.protocol,
                template: 'protocol'
            },
            {
                label: 'Port Range',
                value: this.portRange,
                template: 'portRange'
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

        // System information observables.
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
                value: this.cpus,
                template: 'cpus'
            },
            {
                label: 'Memory',
                value: this.memory,
                template: 'memory'
            }
        ];

        this.observe(
            state$.pipe(get('hosts', 'items', ko.unwrap(name))),
            this.onHost
        );
    }

    onHost(host) {
        if (!host) {
            this.isRetrustButtonVisible(false);
            this.isDeleteButtonWorking(false);
            return;
        }

        const {
            name,
            version,
            lastCommunication,
            ip,
            endpoint,
            rtt,
            hostname,
            upTime, os,
            services
        } = host;

        const hostIsBeingDeleted = host.mode === 'DELETING';

        if (!host.trusted) {
            this.untrustedReasons = flatMap(
                services.storage.nodes,
                node => node.untrusted.map(events => ({ events, drive: node.mount}))
            );
        }

        this.host = name;
        this.hostLoaded(true);
        this.isDeleteButtonWorking(hostIsBeingDeleted);
        this.isRetrustButtonVisible(!host.trusted);
        this.name(getHostDisplayName(name));
        this.version(version);
        this.services(_getServicesString(host));
        this.lastCommunication(moment(lastCommunication).fromNow());
        this.ip(ip);
        this.protocol(_getProtocol(host));
        this.portRange(_getPortRage(host));
        this.endpoint(endpoint);
        this.rtt(`${rtt.toFixed(2)}ms`);
        this.hostname(hostname);
        this.upTime(moment(upTime).fromNow(true));
        this.os(os);
        this.cpus(_getCpusInfo(host));
        this.memory(_getMemoryInfo(host));
    }

    onRetrust() {
        action$.next(openSetNodeAsTrustedModal(this.host, this.untrustedReasons));
    }

    onDeleteNode() {
        action$.next(openConfirmDeleteHostModal(this.host));
    }
}

export default {
    viewModel: HostDetailsFormViewModel,
    template: template
};
