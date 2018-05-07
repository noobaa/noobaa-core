/* Copyright (C) 2016 NooBaa */

import template from './pool-panel.html';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import { realizeUri } from 'utils/browser-utils';
import { get } from 'rx-extensions';

class PoolPanelViewModel extends Observer {
    constructor() {
        super();

        this.selectedTab = ko.observable();
        this.pool = ko.observable();

        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );
    }

    onLocation({ route, params }) {
        const { system, pool, tab = 'nodes' } = params;
        if (!pool) return;

        this.baseRoute = realizeUri(route, { system, pool }, {}, true);
        this.pool(pool);
        this.selectedTab(tab);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: PoolPanelViewModel,
    template: template
};
