import template from './cluster-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';

class ClusterSummaryViewModel extends Disposable{
    constructor() {
        super();

        let shard = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0]
        );

        this.serverCount = ko.pureComputed(
            () => shard() && shard().servers.length
        );

        this.highlyAvaliable = ko.pureComputed(
            () => shard() && (
                shard().high_availabilty ? 'Yes' : 'No'
            )
        );

        this.faultTolerance = ko.pureComputed(
            () => {
                if (!shard()) {
                    return;
                }

                let tolerance = this.serverCount() / 3 | 0;

                return tolerance > 0 ?
                    `${tolerance} server${tolerance > 1 ? 's' : ''}` :
                    'No tolerance';
            }
        );

        this.connectedCount = ko.pureComputed(
            () => shard() && shard().servers
                .filter(
                    server => server.is_connected
                )
                .length
        );

        this.disconnectedCount = ko.pureComputed(
            () => shard() && this.serverCount() - this.connectedCount()
        );
    }
}

export default {
    viewModel: ClusterSummaryViewModel,
    template: template
};
