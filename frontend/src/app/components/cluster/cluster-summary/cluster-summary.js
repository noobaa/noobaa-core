/* Copyright (C) 2016 NooBaa */

import template from './cluster-summary.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { makeArray, countBy, flatMap } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import numeral from 'numeral';
import { getClusterStateIcon } from 'utils/cluster-utils';

const faultToleranceTooltip = `
    The number of servers that can fail (disconnect from the cluster) before the system
    will stop servicing reads and writes
`;

const HATooltip = `
    High availability ensures that the system will keep servicing in the event of one
    or more server failures (dependent on the cluster fault tolerance).
`;

function _getStatus(topology, systemVersion) {
    const statusIcon = getClusterStateIcon(topology, systemVersion);
    return {
        icon: statusIcon.name,
        css: statusIcon.css,
        text: statusIcon.tooltip
    };
}

function _getHA(topology) {
    if (topology.isHighlyAvailable) {
        return {
            icon: 'healthy',
            css: 'success',
            text: 'Highly Available'
        };

    } else {
        return {
            icon: 'problem',
            css: 'error',
            text: 'Not Highly Available'
        };
    }
}

function _getFaultTolerance(topology) {
    const { faultTolerance, isHighlyAvailable } = topology;
    return {
        icon: faultTolerance > 0 ? 'healthy' : 'problem',
        css: faultTolerance > 0 ? 'success' : 'error',
        text: isHighlyAvailable  ?
            stringifyAmount('server', faultTolerance) :
            'Not enough connected servers'
    };
}

function _countServers(servers) {
    const serverList = Object.values(servers);
    const serverCount = serverList.length;
    const byMode = countBy(serverList, server => server.mode);

    return {
        all: serverCount,
        connected: byMode.CONNECTED || 0,
        pending: byMode.IN_PROCESS || 0,
        disconnected: byMode.DISCONNECTED || 0,
        missing: serverCount === 1 ? 2 : (serverCount  + 1) % 2
    };
}

function _getLegend(supportHighAvailability, counters) {
    const missingLabel = `Missing Installed Servers for ${
        supportHighAvailability ? 'next Fault Tolerance': 'H/A'
    }`;

    return {
        caption: `Servers in cluster: ${numeral(counters.all).format(',')}`,
        values: [
            {
                value: counters.connected
            },
            {
                value: counters.pending,
                visible: Boolean(counters.pending)
            },
            {
                value: counters.disconnected
            },
            {
                label: missingLabel,
                value: counters.missing,
                visible: Boolean(counters.missing)
            }
        ]
    };
}

function _getBar(counters) {
    const values = flatMap(
        [
            { color: 'color27', count: counters.connected },
            { color: 'color26', count: counters.pending },
            { color: 'color31', count: counters.disconnected },
            { color: 'color09', count: counters.missing }
        ],
        item => makeArray(item.count).fill({
            value: 1,
            color: `rgb(var(--${item.color}))`
        })
    );

    const markers = [
        {
            position: Math.floor(counters.all / 2) + 1,
            text: 'Minimum for R/W service'
        }
    ];

    return { values, markers };
}

class ClusterSummaryViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    status = {
        icon: ko.observable(),
        css: ko.observable(),
        text: ko.observable()
    };
    ha = {
        icon: ko.observable(),
        css: ko.observable(),
        text: ko.observable(),
        tooltip: HATooltip
    };
    faultTolerance = {
        icon: ko.observable(),
        css: ko.observable(),
        text: ko.observable(),
        tooltip: faultToleranceTooltip
    };
    legend = {
        caption: ko.observable(),
        values: [
            {
                label: 'Connected',
                color: 'rgb(var(--color27))',
                value: ko.observable()
            },
            {
                label: 'Pending',
                color: 'rgb(var(--color26))',
                value: ko.observable(),
                visible: ko.observable()
            },
            {
                label: 'Disconnected',
                color: 'rgb(var(--color31))',
                value: ko.observable()
            },
            {
                label: ko.observable(),
                color: 'rgb(var(--color09))',
                value: ko.observable(),
                visible: ko.observable()
            }
        ]
    };
    bar = {
        values: ko.observableArray(),
        markers: ko.observableArray()
    };

    selectState(state) {
        const { topology, system } = state;
        return [
            topology,
            system && system.version
        ];
    }

    mapStateToProps(topology, systemVersion) {
        if (!topology || !systemVersion) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const counters = _countServers(topology.servers);

            ko.assignToProps(this, {
                dataReady: true,
                status: _getStatus(topology, systemVersion),
                ha: _getHA(topology),
                faultTolerance: _getFaultTolerance(topology),
                legend: _getLegend(topology.supportHighAvailability, counters),
                bar: _getBar(counters)
            });
        }
    }
}

export default {
    viewModel: ClusterSummaryViewModel,
    template: template
};
