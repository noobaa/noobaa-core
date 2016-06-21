import template from './pool-panel.html';
import ko from 'knockout';
import { poolNodeList, systemInfo, routeContext } from 'model';

class PoolPanelViewModel {
    constructor() {
        this.pool = ko.pureComputed(
            () => systemInfo() && systemInfo().pools.find(
                ({ name }) => routeContext().params.pool === name
            )
        );

        this.nodes = poolNodeList;

        this.ready = ko.pureComputed(
            () => !!this.pool()
        );
    }

    isTabSelected() {
        return true;
    }
}

export default {
    viewModel: PoolPanelViewModel,
    template: template
};
