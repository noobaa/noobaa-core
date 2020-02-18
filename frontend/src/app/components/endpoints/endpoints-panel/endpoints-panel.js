/* Copyright (C) 2016 NooBaa */

import template from './endpoints-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class EndpointsPanelViewModel extends ConnectableViewModel {
    baseRoute = ko.observable();
    selectedTab = ko.observable();

    selectState(state) {
        return [
            state.location
        ];
    }

    mapStateToProps(location) {
        const { system, tab = 'statistics' } = location.params;

        ko.assignToProps(this, {
            baseRoute: realizeUri(location.route, { system }, {}, true),
            selectedTab: tab
        });

    }

    tabHref(tab) {
        const route = this.baseRoute();
        if (route) {
            return realizeUri(route, { tab });
        }
    }
}

export default {
    viewModel: EndpointsPanelViewModel,
    template: template
};
