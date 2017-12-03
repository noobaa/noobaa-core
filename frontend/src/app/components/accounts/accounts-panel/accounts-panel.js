/* Copyright (C) 2016 NooBaa */

import template from './accounts-panel.html';
import Observer from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import  { realizeUri } from 'utils/browser-utils';

class AccountsPanelViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.selectedTab = ko.observable();

        this.observe(state$.get('location'), this.onLocation);
    }

    onLocation({ route, params }) {
        const { system, tab = 'accounts' } = params;

        this.baseRoute = realizeUri(route, { system }, {}, true);
        this.selectedTab(tab);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: AccountsPanelViewModel,
    template: template
};
