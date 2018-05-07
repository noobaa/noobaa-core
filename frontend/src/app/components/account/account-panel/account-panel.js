/* Copyright (C) 2016 NooBaa */

import template from './account-panel.html';
import { state$ } from 'state';
import Observer from 'observer';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import { getMany } from 'rx-extensions';

class AccountPanelViewModel extends Observer {
    constructor() {
        super();

        this.baseRoute = '';
        this.selectedTab = ko.observable();
        this.account = ko.observable();
        this.isCurrentUser = ko.observable();

        this.observe(
            state$.pipe(
                getMany(
                    'location',
                    ['session', 'user']
                )
            ),
            this.onLocation
        );
    }

    onLocation([location, user]) {
        const { route, params } = location;
        const { system, account, tab = 's3-access' } = params;
        if (!account) return;

        this.baseRoute = realizeUri(route, { system, account }, {}, true);
        this.selectedTab(tab);
        this.account(account);
        this.isCurrentUser(account === user);
    }

    tabHref(tab) {
        return realizeUri(this.baseRoute, { tab });
    }
}

export default {
    viewModel: AccountPanelViewModel,
    template: template
};
