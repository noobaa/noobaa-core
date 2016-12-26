import template from './cluster-overview.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { stringifyAmount } from 'utils/string-utils';
import { systemInfo } from 'model';


class ClusterOverviewViewModel extends Disposable{
    constructor() {
        super();

        this.serverCount = ko.pureComputed(
            () => {
                const count = (
                    systemInfo() ? systemInfo().cluster.shards[0].servers : []
                ).length;

                return stringifyAmount('Server', count, 'No');
            }
        );

    }
}

export default {
    viewModel: ClusterOverviewViewModel,
    template: template
};
