import template from './cluster-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import style from 'style';
import { deepFreeze, makeArray } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { drawLine, fillCircle } from 'utils/canvas-utils';

const faultToleranceTooltip = `
    The number of servers the can disconnect before the clsuter will stop R/W
    service
`;

const HATooltip = `
    High availability increases the likehood that your app stays up in the
    event of failure
    <br><br>
    To reach an highly available cluster make sure you have an odd number of
    servers connected with at least one fault tolerance server
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
            name: 'notif-warning',
            css: 'warning'
        }
    },
    UNHEALTHY: {
        text: 'Not enough connected servers',
        icon:  iconMapping[false]
    }
});

// Check if server has issues.
function serverHasIssues(server, systemVersion) {
    const { version, services_status = {} } = server;

    if (version !== systemVersion) {
        return true;
    }

    const { dns_servers } = services_status;
    if (dns_servers && dns_servers !== 'OPERATIONAL') {
        return true;
    }

    const { dns_name_resolution } = services_status;
    if (dns_name_resolution && dns_name_resolution !== 'OPERATIONAL') {
        return true;
    }

    const { ntp_server } = services_status;
    if (ntp_server && ntp_server !== 'OPERATIONAL') {
        return true;
    }

    const { internal_cluster_connectivity } = services_status;
    return internal_cluster_connectivity.some(
        ({ status }) => status !== 'OPERATIONAL'
    );
}

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
            () => Math.ceil(serverCount() / 2 - 1) - disconnected()
        );

        const missing = ko.pureComputed(
            () => serverCount() === 1 ? 2 : (serverCount()  + 1) % 2
        );

        const status = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return 'UNHEALTHY';
                }

                if (connected() < this.minForReadWrite()) {
                    return 'UNHEALTHY';
                }

                const systemVersion = systemInfo().version;
                const issueCount = servers()
                    .filter(
                        server => server.status === 'CONNECTED' &&
                            serverHasIssues(server, systemVersion)
                    )
                    .length;

                if (issueCount > connected() / 2) {
                    return 'WITH_ISSUES';
                }

                return 'HEALTHY';
            }
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
                label: 'Conected:',
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
                    () => `Missing installed servers for ${
                        serverCount() > 3 ? 'next fault tolerance': 'H/A'
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
