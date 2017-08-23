/* Copyright (C) 2016 NooBaa */

import template from './host-panel.html';
import Observer  from 'observer';
import { state$, action$ } from 'state';
import { fetchHosts, dropHostsView } from 'action-creators';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class HostPanelViewModel extends Observer {
    constructor() {
        super();

        this.viewName = this.constructor.name;
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

        // Load/update the host data.
        action$.onNext(fetchHosts(this.viewName, { hosts: [ko.unwrap(host)] }, true));
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }

    dispose() {
        action$.onNext(dropHostsView(this.viewName));
        super.dispose();
    }
}

export default {
    viewModel: HostPanelViewModel,
    template: template
};
