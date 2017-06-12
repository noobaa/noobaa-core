/* Copyright (C) 2016 NooBaa */

import template from './account-panel.html';
import { state$ } from 'state';
import Observer from 'observer';
import ko from 'knockout';

class AccountPanelViewModel extends Observer {
    constructor() {
        super();

        this.selectedTab = ko.observable();
        this.account = ko.observable();

        this.observe(state$.get('location', 'params', 'tab'), this.onTab);
    }

    onTab(tab = 's3-access') {
        this.selectedTab(tab);
    }

    tabHref(tab) {
        return {
            route: 'account',
            params: { tab }
        };
    }

    tabCss(tab) {
        return {
            tab: true,
            selected: this.selectedTab() === tab
        };
    }
}

export default {
    viewModel: AccountPanelViewModel,
    template: template
};
