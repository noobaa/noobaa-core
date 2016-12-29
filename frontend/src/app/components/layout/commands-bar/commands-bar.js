import template from './commands-bar.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { refresh, openDrawer } from 'actions';
import { sleep } from 'utils/promise-utils';

class CommandBarViewModel extends BaseViewModel {
    constructor() {
        super();

        this.isRefreshSpinning = ko.observable(false);
    }

    refresh() {
        refresh();

        this.isRefreshSpinning(true);
        sleep(1000, false).then(this.isRefreshSpinning);
    }

    showAuditLog() {
        openDrawer();
    }
}

export default {
    viewModel: CommandBarViewModel,
    template: template
};
