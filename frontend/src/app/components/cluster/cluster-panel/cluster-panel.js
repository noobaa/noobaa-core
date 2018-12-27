/* Copyright (C) 2016 NooBaa */

import template from './cluster-panel.html';
import ConnectableViewModel from 'components/connectable';
import { realizeUri } from 'utils/browser-utils';
import ko from 'knockout';

class ClusterPanelViewModel extends ConnectableViewModel {
    baseRoute = ko.observable();
    selectedTab = ko.observable();

    selectState(state) {
        return [
            state.location
        ];
    }

    mapStateToProps(location) {
        const { system, tab = 'servers' } = location.params;

        ko.assignToProps(this, {
            baseRoute: realizeUri(location.route, { system }, {}, true),
            selectedTab: tab
        });
    }

    tabHref(tab) {
        const route = this.baseRoute();
        return route ? realizeUri(route, { tab }) : '';
    }
}

export default {
    viewModel: ClusterPanelViewModel,
    template: template
};
