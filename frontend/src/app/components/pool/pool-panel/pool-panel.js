/* Copyright (C) 2016 NooBaa */

import template from './pool-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class PoolPanelViewModel extends ConnectableViewModel {
    baseRoute = ko.observable();
    pool = ko.observable();
    selectedTab = ko.observable();

    selectState(state) {
        return [
            state.location
        ];
    }

    mapStateToProps(location) {
        const { system, pool, tab = 'nodes' } = location.params;
        if (!pool) return;

        ko.assignToProps(this, {
            baseRoute: realizeUri(location.route, { system, pool }, {}, true),
            pool: pool,
            selectedTab: tab
        });
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute(), { tab });
    }
}

export default {
    viewModel: PoolPanelViewModel,
    template: template
};
