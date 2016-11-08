import template from './account-menu.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { support } from 'config';
import { signOut } from 'actions';

class AccountMenuViewModel extends Disposable{
    constructor() {
        super();

        this.isOpen = ko.observable(false);
        this.isLocalClick = ko.observable(false);

        this.userEmail = ko.observable('ohad.mitrani@noobaa.com');
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
        signOut();
    }
}

export default {
    viewModel: AccountMenuViewModel,
    template: template
};
