/* Copyright (C) 2016 NooBaa */

import template from './analytics-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import  { realizeUri } from 'utils/browser-utils';

class AnalyticsPanelViewModel extends ConnectableViewModel {
    baseRoute = ko.observable();
    selectedTab = ko.observable();

    selectState(state) {
        return [
            state.location
        ];
    }

    mapStateToProps(location) {
        const { route, params } = location;
        const { system, tab = 'traffic' } = params;

        ko.assignToProps(this, {
            baseRoute: realizeUri(route, { system }, {}, true),
            selectedTab: tab
        });
    }

    tabHref(tab) {
        const baseRoute = this.baseRoute();
        if (!baseRoute) return;

        return realizeUri(baseRoute, { tab });
    }
}

export default {
    viewModel: AnalyticsPanelViewModel,
    template: template
};
