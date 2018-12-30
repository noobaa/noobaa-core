/* Copyright (C) 2016 NooBaa */

import template from './account-menu.html';
import ko from 'knockout';
import ConnectableViewModel from 'components/connectable';
import { realizeUri, formatEmailUri } from 'utils/browser-utils';
import { support } from 'config';
import { signOut } from 'action-creators';
import * as routes from 'routes';

class AccountMenuViewModel extends ConnectableViewModel {
    isOpen = ko.observable(false);
    isLocalClick = ko.observable(false);
    accountName = ko.observable();
    accountPageHref = ko.observable();
    supportEmailHref = formatEmailUri(support.email);
    helpDeskHref = support.helpDesk;

    selectState(state) {
        const { session, location } = state;
        return [
            location.params.system,
            session && state.session.user
        ];
    }

    mapStateToProps(system, account) {
        if (!account) {
            return;
        }

        ko.assignToProps(this, {
            accountName: account,
            accountPageHref: realizeUri(
                routes.account,
                { system, account }
            )
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

    onSignOut() {
        this.dispatch(signOut());
    }
}

export default {
    viewModel: AccountMenuViewModel,
    template: template
};
