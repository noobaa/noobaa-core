import template from './commands-bar.html';
import ko from 'knockout';
import { uiState } from 'model';
import { refresh, signOut, openDrawer, closeDrawer } from 'actions';

class CommandBarViewModel {
    constructor() {
        this.isDrawerOpen = ko.pureComputed(
            () => !!uiState().drawer
        );
    }

    refresh() {
        refresh();
    }

    showAuditLog() {
        this.isDrawerOpen() ? closeDrawer() : openDrawer();
    }

    signOut() {
        signOut();
    }
}

export default {
    viewModel: CommandBarViewModel,
    template: template
};
