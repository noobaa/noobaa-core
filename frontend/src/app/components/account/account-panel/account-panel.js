/* Copyright (C) 2016 NooBaa */

import template from './account-panel.html';
import { state$ } from 'state';
import Observer from 'observer';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class AccountPanelViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.selectedTab = ko.observable();
        this.account = ko.observable();

        this.observe(state$.get('location'), this.onLocation);
    }

    onLocation({ route, params }) {
        const { system, account, tab = 's3-access' } = params;
        if (!account) return;

        this.baseRoute = realizeUri(route, { system, account }, {}, true);
        this.selectedTab(tab);
        this.account(account);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: AccountPanelViewModel,
    template: template
};
