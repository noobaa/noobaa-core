/* Copyright (C) 2016 NooBaa */

import template from './management-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import { requestLocation } from 'action-creators';

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

    onSection(section) {
        const tab = this.selectedTab();
        const uri = realizeUri(this.baseRoute(), { tab, section });

        this.dispatch(requestLocation(uri));
    }

    tabHref(tab) {
        return (
            this.baseRoute() &&
            realizeUri(this.baseRoute(), { tab })
        );
    }


    sectionToggle(section) {
        return ko.pureComputed({
            read: () => this.selectedSection() !== section,
            write: val => this.onSection(val ? '' : section)
        });
    }
}

export default {
    viewModel: ManagementPanelViewModel,
    template: template
};
