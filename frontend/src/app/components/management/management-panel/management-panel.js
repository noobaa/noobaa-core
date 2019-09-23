/* Copyright (C) 2016 NooBaa */

import template from './management-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class ManagementPanelViewModel extends ConnectableViewModel {
    baseRoute = ko.observable();
    selectedTab = ko.observable();
    selectedSection = ko.observable();

    selectState(state) {
        return [
            state.location
        ];
    }

    mapStateToProps(location) {
        const { system, tab = 'settings', section } = location.params;

        ko.assignToProps(this, {
            baseRoute: realizeUri(location.route, { system }, {}, true),
            selectedTab: tab,
            selectedSection: section || ''
        });
    }

    tabHref(tab) {
        return (
            this.baseRoute() &&
            realizeUri(this.baseRoute(), { tab })
        );
    }
}

export default {
    viewModel: ManagementPanelViewModel,
    template: template
};
