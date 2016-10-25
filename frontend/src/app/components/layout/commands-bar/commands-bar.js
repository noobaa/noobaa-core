import template from './commands-bar.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { uiState } from 'model';
import { refresh, signOut, openDrawer, closeDrawer } from 'actions';
import { waitFor } from 'utils';

class CommandBarViewModel extends Disposable {
    constructor() {
        super();

        this.isDrawerOpen = ko.pureComputed(
            () => !!uiState().drawer
        );

        this.isRefreshSpinning = ko.observable(false);
    }

    refresh() {
        refresh();

        this.isRefreshSpinning(true);
        waitFor(1000, false).then(this.isRefreshSpinning);
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
