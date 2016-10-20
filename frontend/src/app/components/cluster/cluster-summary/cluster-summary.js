import template from './cluster-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import style from 'style';

class ClusterSummaryViewModel extends Disposable{
    constructor() {
        super();

        let shard = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0]
        );

        let servers = ko.pureComputed(
            () => shard() ? shard().servers : []
        );


        this.serverCount = ko.pureComputed(
            () => servers().length
        );

        this.HAStatus = ko.pureComputed(
            () => (shard() && shard().high_availabilty) ?
                'Highly Available' :
                'Not Highly Available'
        );

        this.connectedCount = ko.pureComputed(
            () => servers()
                .filter(
                    server => server.status === 'CONNECTED'
                )
                .length
        );

        this.faultTolerance = ko.pureComputed(
            () => {
                let tolerance = Math.ceil(this.connectedCount() / 2 - 1);

                return tolerance > 0 ?
                    `${tolerance} server${tolerance > 1 ? 's' : ''}` :
                    'No Tolerance';
            }
        );

        this.inProcessCount = ko.pureComputed(
            () => servers()
                .filter(
                    server => server.status === 'IN_PROGREES'
                ).length
        );

        this.disconnectedCount = ko.pureComputed(
            () => servers()
                .filter(
                    server => server.status === 'DISCONNECTED'
                ).length
        );


        this.chartValues = [
            {
                label: 'Used (this bucket)',
                color: style['color13'],
                value: this.connectedCount
            },
            {
                label: 'Potential available',
                color: style['color5'],
                value: this.disconnectedCount
            }
        ];

        this.connectedPercentage = ko.pureComputed(
            () => this.connectedCount() / this.serverCount()
        ).extend({
            formatNumber: { format: '%' }
        });
    }
}

export default {
    viewModel: ClusterSummaryViewModel,
    template: template
};
