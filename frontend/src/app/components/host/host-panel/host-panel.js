/* Copyright (C) 2016 NooBaa */

import template from './host-panel.html';
import Observer  from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class HostPanelViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.host = ko.observable();
        this.selectedTab = ko.observable();

        this.observe(state$.get('location'), this.onLocation);
    }

    onLocation({ route, params }) {
        const { system, pool, host, tab = 'details' } = params;
        if (!host) return;

        this.host(host);
        this.baseRoute = realizeUri(route, { system, pool, host }, {}, true);
        this.selectedTab(tab);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: HostPanelViewModel,
    template: template
};
