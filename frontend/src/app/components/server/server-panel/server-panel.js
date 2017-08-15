/* Copyright (C) 2016 NooBaa */

import template from './server-panel.html';
import Observer from 'observer';
import { state$ } from 'state';
import { lastSegment } from 'utils/string-utils';
import { realizeUri } from 'utils/browser-utils';
import ko from 'knockout';

class ServerPanelViewModel extends Observer {
    constructor() {
        super();

        this.selectedTab = ko.observable();
        this.serverSecret = ko.observable();
        this.baseRoute = '';
        this.system = ko.observable();
        this.observe(state$.get('location'), this.onLocation);
    }

    onLocation({ route, params }) {
        const { system, server, tab = 'details' } = params;
        if (!server) return;
        this.system(system);
        this.baseRoute = realizeUri(route, { system, server }, {}, true);
        this.selectedTab(tab);
        this.serverSecret(server && lastSegment(server, '-'));
    }


    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: ServerPanelViewModel,
    template: template
};
