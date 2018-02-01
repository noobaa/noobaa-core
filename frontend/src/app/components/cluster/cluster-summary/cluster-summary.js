/* Copyright (C) 2016 NooBaa */

import template from './cluster-summary.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import style from 'style';
import { deepFreeze, makeArray } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { drawLine, fillCircle } from 'utils/canvas-utils';
import { getClusterStatus } from 'utils/cluster-utils';

const faultToleranceTooltip = `
    The number of servers that can fail (disconnect from the cluster) before the system
    will stop servicing reads and writes
`;

const HATooltip = `
    High availability ensures that the system will keep servicing in the event of one
    or more server failures (dependent on the cluster fault tolerance).
`;

const minReadWritePointText = 'Minimum for\nR/W service';

const iconMapping = deepFreeze({
    true: {
        name: 'healthy',
        css: 'success'
    },

    false: {
        name: 'problem',
        css: 'error'
    }
});

const statusMapping = deepFreeze({
    HEALTHY: {
        text: 'Healthy',
        icon: iconMapping[true]
    },
    WITH_ISSUES: {
        text: 'Cluster has a high number of issues',
        icon: {
            name: 'problem',
            css: 'warning'
        }
    },
    UNHEALTHY: {
        text: 'Not enough connected servers',
        icon:  iconMapping[false]
    }
});

class ClusterSummaryViewModel extends BaseViewModel {
    constructor() {
        super();

        const shard = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0]
        );

        const servers = ko.pureComputed(
            () => shard() ? shard().servers : []
        );


        const serverCount = ko.pureComputed(
            () => servers().length
        );

        const connected = ko.pureComputed(
            () => servers()
                .filter( server => server.status === 'CONNECTED' )
                .length
        );

        const pending = ko.pureComputed(
            () => servers()
                .filter( server => server.status === 'IN_PROGREES' )
                .length
        );

        const disconnected = ko.pureComputed(
            () => servers()
                .filter( server => server.status === 'DISCONNECTED' )
                .length
        );

        const faultTolerance = ko.pureComputed(
            () => Math.ceil(serverCount() / 2 - 1) - disconnected()
        );

        const missing = ko.pureComputed(
            () => serverCount() === 1 ? 2 : (serverCount()  + 1) % 2
        );

        const status = ko.pureComputed(
            () => systemInfo() ?
                getClusterStatus(systemInfo().cluster, systemInfo().version) :
                'UNHEALTHY'
        );

        this.statusText = ko.pureComputed(
            () => statusMapping[status()].text
        );

        this.statusIcon = ko.pureComputed(
            () => statusMapping[status()].icon
        );

        this.minForReadWrite = ko.pureComputed(
            () => Math.floor(serverCount() / 2) + 1
        );

        const isHighlyAvailable = ko.pureComputed(
            () => faultTolerance() > 0
        );

        this.faultToleranceIcon = ko.pureComputed(
            () => iconMapping[faultTolerance() > 0]
        );

        this.faultToleranceText = ko.pureComputed(
            () => isHighlyAvailable() ?
                stringifyAmount('server', faultTolerance()) :
                'Not enough connected servers'
        );

        this.faultToleranceTooltip = faultToleranceTooltip;

        this.HAIcon = ko.pureComputed(
            () => iconMapping[isHighlyAvailable()]
        );

        this.HAText = ko.pureComputed(
            () => isHighlyAvailable() ? 'Highly Available' : 'Not Highly Available'
        );

        this.HATooltip = HATooltip;

        this.chartCaption = ko.pureComputed(
            () => `Servers in cluster: ${serverCount()}`
        );

        this.chartValues = [
            {
                label: 'Connected:',
                color: style['color12'],
                value: connected
            },
            {
                label: 'Disconnected:',
                color: style['color10'],
                value: disconnected
            },
            {
                label: 'Pending:',
                color: style['color11'],
                value: pending,

                // Hide until attch server will be implemented as a
                // non blocking process
                visible: false
            },
            {
                label: ko.pureComputed(
                    () => `Missing Installed Servers for ${
                        serverCount() > 3 ? 'next Fault Tolerance': 'H/A'
                    }:`
                ),
                color: style['color15'],
                value: missing,
                visible: missing
            }
        ];

        this.segments = ko.pureComputed(
            () => [].concat(
                makeArray(connected(), () => style['color12']),
                makeArray(disconnected(), () => style['color10']),
                makeArray(pending(), () => style['color11']),
                makeArray(missing(), () => style['color15'])
            )
        );

        this.redraw = ko.observable();
    }

    drawChart(ctx, { width }) {
        // Create a dependency on redraw allowing us to redraw every time,
        // the value of redraw changed.
        this.redraw();

        const baseLine = 6;
        const segments = this.segments();
        const segmentWidth = width / segments.length;

        for (let i = 0; i < segments.length; ++i) {
            ctx.strokeStyle = segments[i];
            drawLine(ctx, i * segmentWidth, baseLine, (i + 1) * segmentWidth, baseLine);

        }

        ctx.lineWidth = 1;
        ctx.strokeStyle = style['color7'];
        drawLine(ctx, 0, 0, 0, baseLine * 2);
        drawLine(ctx, width, 0, width, baseLine * 2);

        ctx.fillStyle = style['color7'];
        for (let i = 1; i < segments.length; ++i) {
            const x = i * segmentWidth;
            fillCircle(ctx, x, baseLine, 4);

            if (i === this.minForReadWrite()) {
                drawLine(ctx, x, baseLine, x, baseLine + 12);

                ctx.font = `12px ${style['font-family1']}`;
                ctx.textAlign = 'center';

                minReadWritePointText.split(/\n/g).forEach(
                    (line, i) => {
                        const y = baseLine * 2 + 8 + (i +1) * 14;
                        ctx.fillText(line, x, y);
                    }
                );


            }
        }
    }

    triggerRedraw() {
        this.redraw.toggle();
    }
}

export default {
    viewModel: ClusterSummaryViewModel,
    template: template
};
