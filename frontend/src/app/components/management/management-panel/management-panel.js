/* Copyright (C) 2016 NooBaa */

import template from './management-panel.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import { get } from 'rx-extensions';
import { requestLocation } from 'action-creators';

class ManagementPanelViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.selectedTab = ko.observable();
        this.selectedSection = ko.observable();

        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );
    }

    onLocation({ route, params }) {
        const { system, tab = 'settings', section } = params;

        this.baseRoute = realizeUri(route, { system }, {}, true);
        this.selectedTab(tab);
        this.selectedSection(section);
    }

    onSection(section) {
        const tab = this.selectedTab();
        const uri = realizeUri(this.baseRoute, { tab, section });

        action$.next(requestLocation(uri));
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }


    sectionToggle(section) {
        return ko.pureComputed({
            read: () => this.selectedSection() !== section,
            write: val => this.onSection(val ? null : section)
        });
    }
}

export default {
    viewModel: ManagementPanelViewModel,
    template: template
};
