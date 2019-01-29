/* Copyright (C) 2016 NooBaa */

import template from './account-panel.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class AccountPanelViewModel extends ConnectableViewModel {
    baseRoute = ko.observable();
    selectedTab = ko.observable();
    account = ko.observable();
    isCurrentUser = ko.observable();

    selectState(state) {
        const { location, session } = state;
        return [
            location,
            session && session.user
        ];
    }

    mapStateToProps(location, user) {
        const { system, account, tab = 's3-access' } = location.params;
        if (!account) return;

        ko.assignToProps(this, {
            baseRoute: realizeUri(location.route, { system, account }, {}, true),
            selectedTab: tab,
            account: account,
            isCurrentUser: account === user
        });

    }

    tabHref(tab) {
        const route = this.baseRoute();
        return route ? realizeUri(route, { tab }) : '';
    }
}

export default {
    viewModel: AccountPanelViewModel,
    template: template
};
