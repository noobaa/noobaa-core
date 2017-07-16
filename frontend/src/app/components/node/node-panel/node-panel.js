/* Copyright (C) 2016 NooBaa */

import template from './node-panel.html';
import Observer  from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class NodePanelViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.selectedTab = ko.observable();

        this.observe(state$.get('location'), this.onLocation);
    }

    onLocation({ route, params }) {
        const { system, pool, node, tab = 'details' } = params;
        if (!node) return;

        this.baseRoute = realizeUri(route, { system, pool, node }, {}, true);
        this.selectedTab(tab);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: NodePanelViewModel,
    template: template
};
