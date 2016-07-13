import template from './pool-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { poolNodeList, systemInfo, routeContext } from 'model';

class PoolPanelViewModel extends Disposable {
    constructor() {
        super();

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
