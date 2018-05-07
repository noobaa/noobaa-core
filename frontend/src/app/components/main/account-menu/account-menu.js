/* Copyright (C) 2016 NooBaa */

import template from './account-menu.html';
import ko from 'knockout';
import { sessionInfo } from 'model';
import { support } from 'config';
import { action$ } from 'state';
import { signOut } from 'action-creators';

const supportEmailUri = `mailto:${support.email}`;

class AccountMenuViewModel {
    constructor() {
        this.isOpen = ko.observable(false);
        this.isLocalClick = ko.observable(false);

        // TODO: A workaroun for rece between pureComputed that is depended on
        // sessionInfo and state$ updates.
        this.userEmail = ko.pureComputed(
            () => sessionInfo() ? sessionInfo().user : 'WORKAROUND'
        );

        this.profileHref = {
            route: 'account',
            params: { account: this.userEmail, tab: null }
        };

        this.supportEmailUri = supportEmailUri;
        this.helpDeskUri = support.helpDesk;
    }

    onLocalClick() {
        this.isOpen.toggle();
        this.isLocalClick(true);
    }

    onGlobalClick() {
        if (!this.isLocalClick()) {
            this.isOpen(false);
        }

        this.isLocalClick(false);
    }

    onSignOut() {
        action$.next(signOut());
    }
}

export default {
    viewModel: AccountMenuViewModel,
    template: template
};
