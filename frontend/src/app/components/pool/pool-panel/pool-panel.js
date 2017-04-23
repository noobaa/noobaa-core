/* Copyright (C) 2016 NooBaa */

import template from './pool-panel.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { poolNodeList, systemInfo, routeContext, uiState } from 'model';

class PoolPanelViewModel extends BaseViewModel {
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

    tabHref(tab) {
        return {
            route: 'pool',
            params: { tab }
        };
    }

    tabCss(tab) {
        return {
            selected: uiState().tab === tab
        };
    }
}

export default {
    viewModel: PoolPanelViewModel,
    template: template
};
