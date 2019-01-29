/* Copyright (C) 2016 NooBaa */

import template from './account-menu.html';
import ko from 'knockout';
import ConnectableViewModel from 'components/connectable';
import { capitalize } from 'utils/string-utils';
import { realizeUri, formatEmailUri } from 'utils/browser-utils';
import { support } from 'config';
import { updateAccountUITheme, signOut } from 'action-creators';
import * as routes from 'routes';

class AccountMenuViewModel extends ConnectableViewModel {
    isOpen = ko.observable(false);
    isLocalClick = ko.observable(false);
    accountName = ko.observable();
    accountPageHref = ko.observable();
    supportEmailHref = formatEmailUri(support.email);
    helpDeskHref = support.helpDesk;
    oppositeTheme = '';
    switchThemeText = ko.observable();

    selectState(state) {
        const { session, location } = state;
        return [
            location.params.system,
            session && state.session
        ];
    }

    mapStateToProps(system, session) {
        if (!session) {
            return;
        }

        const { user: account, uiTheme } = session;
        const oppositeTheme = uiTheme === 'dark' ? 'light': 'dark';
        ko.assignToProps(this, {
            accountName: account,
            accountPageHref: realizeUri(
                routes.account,
                { system, account }
            ),
            oppositeTheme,
            switchThemeText: `Switch to ${capitalize(oppositeTheme)} Theme`
        });
    }

    onLocalClick() {
        ko.assignToProps(this, {
            isOpen: !this.isOpen(),
            isLocalClick: true
        });
    }

    onGlobalClick() {
        ko.assignToProps(this, {
            isOpen: this.isLocalClick() && this.isOpen(),
            isLocalClick: false
        });
    }

    onSwitchTheme() {
        this.dispatch(updateAccountUITheme(
            this.accountName(),
            this.oppositeTheme
        ));
    }

    onSignOut() {
        this.dispatch(signOut());
    }
}

export default {
    viewModel: AccountMenuViewModel,
    template: template
};
