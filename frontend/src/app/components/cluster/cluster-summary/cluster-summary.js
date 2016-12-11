import template from './cluster-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import style from 'style';
import { deepFreeze, makeArray } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { drawLine, fillCircle } from 'utils/canvas-utils';

const faultToleranceTooltip = `
    The number of servers the can disconnect before the clsuter will stop being
    highly available
`;

const HATooltip = `
    High availability increases the likehood that your app stays up in the
    event of failure
    <br><br>
    To reach an highly available cluster make sure you have an odd number of
    servers connected with at least one fault tolerance server
`;

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


class ClusterSummaryViewModel extends Disposable{
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
                .filter(
                    server => server.status === 'CONNECTED'
                )
                .length
        );

        const pending = ko.pureComputed(
            () => servers()
                .filter(
                    server => server.status === 'IN_PROGREES'
                ).length
        );

        const disconnected = ko.pureComputed(
            () => servers()
                .filter(
                    server => server.status === 'DISCONNECTED'
                ).length
        );

        const faultTolerance = ko.pureComputed(
            () => Math.ceil(connected() / 2 - 1)
        );

        const missing = ko.pureComputed(
            () => Math.ceil(serverCount() / 2) * 2 + 1 - serverCount()
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
                'Not enough conncted servers'
        );

        this.faultToleranceTooltip = faultToleranceTooltip;

        this.HAIcon = ko.pureComputed(
            () => iconMapping[isHighlyAvailable()]
        );

        this.HAText = ko.pureComputed(
            () => isHighlyAvailable() ? 'On' : 'Off'
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
                label: 'Disconected:',
                color: style['color10'],
                value: disconnected
            },
            {
                label: 'Pending:',
                color: style['color11'],
                value: pending
            },
            {
                label: ko.pureComputed(
                    () => `Missing servers for ${
                        isHighlyAvailable() ? 'next fault tolerance': 'H/A'
                    }:`
                ),
                color: style['color15'],
                value: missing
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

    drawChart(ctx, { width, height }) {
        // Create a dependency on redraw allowing us to redraw every time,
        // the value of redraw changed.
        this.redraw();

        const middle = height / 2 | 0;
        const segments = this.segments();
        const segmentWidth = width / segments.length;

        for (let i = 0; i < segments.length; ++i) {
            ctx.strokeStyle = segments[i];
            drawLine(ctx, i * segmentWidth, middle, (i + 1) * segmentWidth, middle);

        }

        ctx.lineWidth = 1;
        ctx.strokeStyle = style['color7'];
        drawLine(ctx, 0, 0, 0, height);
        drawLine(ctx, width, 0, width, height);

        ctx.fillStyle = style['color7'];
        for (let i = 1; i < segments.length; ++i) {
            fillCircle(ctx, i * segmentWidth, middle, 4);
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
