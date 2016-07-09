import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import numeral from 'numeral';
import template from './pools-overview.html';

class PoolsOverviewViewModel extends BaseViewModel {
    constructor({poolCount, nodeCount}) {
        super();

        this.poolCountText = ko.pureComputed(() => {
            let count = ko.unwrap(poolCount);
            return `${numeral(count).format('0,0')} Pools`;
        });

        this.nodeCountText = ko.pureComputed(() => {

            let count = ko.unwrap(nodeCount);
            return `${numeral(count).format('0,0')} Nodes`;
        });
    }
}

export default {
    viewModel: PoolsOverviewViewModel,
    template: template
};
