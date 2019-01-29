/* Copyright (C) 2016 NooBaa */

import template from './host-details-form.html';
import ConnectableViewModel from 'components/connectable';
import { mapValues, flatMap, decimalRound } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import { getHostDisplayName } from 'utils/host-utils';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import { openSetNodeAsTrustedModal, openConfirmDeleteHostModal } from 'action-creators';

const portsBlockedTooltip = `Some ports might be blocked. Check the firewall settings
    and make sure that the ports range of 60100-60600 is open for inbound traffic.
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

    return {
        template: 'listWithCaption',
        text: {
            title: `${usageLevel} ${subject} Pressure`.trim(),
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

function _getUntrustedReasons(host) {
    if (host.trusted) {
        return [];
    } else {
        return flatMap(
            host.services.storage.nodes,
            node => node.untrusted.map(events => ({ events, drive: node.mount}))
        );
    }
}

class HostDetailsFormViewModel extends ConnectableViewModel {
    hostLoaded = ko.observable();
    hostName = '';
    isDeleteButtonWorking = ko.observable();
    isRetrustButtonVisible = ko.observable();
    untrustedReasons = [];
    daemonInfo = [
        {
            label: 'Node Name',
            value: ko.observable()
        },
        {
            label: 'Installed Version',
            value: ko.observable()
        },
        {
            label: 'Services',
            value: ko.observable()
        },
        {
            label: 'Last Communication',
            value: ko.observable()
        },
        {
            label: 'Communication IP',
            value: ko.observable()
        },
        {
            label: 'Peer to Peer Connectivity',
            value: ko.observable(),
            template: 'protocol'
        },
        {
            label: 'Port Range',
            value: ko.observable(),
            template: 'portRange'
        },
        {
            label: 'Server Endpoint',
            value: ko.observable()
        },
        {
            label: 'Round Trip Time',
            value: ko.observable()
        }
    ];
    systemInfo = [
        {
            label: 'Host Name',
            value: ko.observable()
        },
        {
            label: 'Up Time',
            value: ko.observable()
        },
        {
            label: 'OS Type',
            value: ko.observable()
        },
        {
            label: 'CPUs',
            value: ko.observable(),
            template: 'cpus'
        },
        {
            label: 'Memory',
            value: ko.observable(),
            template: 'memory'
        }
    ];

    selectState(state, params) {
        const { hosts } = state;
        return [
            hosts && hosts.items[params.name]
        ];
    }

    mapStateToProps(host) {
        if (!host) {
            ko.assignToProps(this, {
                hostLoaded: false,
                isDeleteButtonWorking: false,
                isRetrustButtonVisible: false
            });

        } else {
            const {
                name,
                version,
                lastCommunication,
                ip,
                endpoint,
                rtt,
                hostname,
                upTime,
                os
            } = host;

            ko.assignToProps(this, {
                hostLoaded: true,
                hostName: name,
                isDeleteButtonWorking: host.mode === 'DELETING',
                isRetrustButtonVisible: !host.trusted,
                untrustedReasons: _getUntrustedReasons(host),
                daemonInfo: [
                    { value: getHostDisplayName(name) },
                    { value: version },
                    { value: _getServicesString(host) },
                    { value:  moment(lastCommunication).fromNow() },
                    { value: ip },
                    { value: _getProtocol(host) },
                    { value: _getPortRage(host) },
                    { value: endpoint },
                    { value: `${rtt.toFixed(2)}ms` }
                ],
                systemInfo: [
                    { value: hostname },
                    { value: moment(upTime).fromNow(true) },
                    { value: os },
                    { value: _getCpusInfo(host) },
                    { value: _getMemoryInfo(host) }
                ]
            });
        }
    }

    onRetrust() {
        this.dispatch(openSetNodeAsTrustedModal(
            this.hostName,
            this.untrustedReasons
        ));
    }

    onDeleteNode() {
        this.dispatch(openConfirmDeleteHostModal(this.hostName));
    }
}

export default {
    viewModel: HostDetailsFormViewModel,
    template: template
};
