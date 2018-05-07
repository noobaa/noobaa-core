/* Copyright (C) 2016 NooBaa */

import template from './resources-panel.html';
import Observer  from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import  { realizeUri } from 'utils/browser-utils';
import { get } from 'rx-extensions';

class ResourcesPanelViewModel extends Observer  {
    constructor() {
        super();

        this.selectedTab = ko.observable();
        this.baseRoute = '';

        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );
    }

    onLocation({ route, params }) {
        const { system, tab = 'pools' } = params;

        this.baseRoute = realizeUri(route, { system }, {}, true);
        this.selectedTab(tab);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: ResourcesPanelViewModel,
    template: template
};
