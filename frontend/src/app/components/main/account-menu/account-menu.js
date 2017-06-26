/* Copyright (C) 2016 NooBaa */

import template from './account-menu.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { sessionInfo } from 'model';
import { support } from 'config';
import { dispatch } from 'state';
import { signOut } from 'action-creators';

class AccountMenuViewModel extends BaseViewModel {
    constructor() {
        super();

        this.isOpen = ko.observable(false);
        this.isLocalClick = ko.observable(false);

        // TODO: A workaroun for rece between pureComputed that is depended on
        // sessionInfo and state$ updates.
        this.userEmail = ko.pureComputed(
            () => sessionInfo() ? sessionInfo().user : 'WORKAROUND'
        );

        this.profileHref = {
            route: 'account',
            params: {
                account: this.userEmail,
                tab: 'details'
            }
        };

        this.supportEmailUri = `mailto:${support.email}`;
        this.helpDeskUri = support.helpDesk;
    }

    handleLocalClick() {
        this.isOpen.toggle();
        this.isLocalClick(true);
    }

    handleGlobalClick() {
        if (!this.isLocalClick()) {
            this.isOpen(false);
        }

        this.isLocalClick(false);
    }

    signOut() {
        dispatch(signOut());
    }
}

export default {
    viewModel: AccountMenuViewModel,
    template: template
};
