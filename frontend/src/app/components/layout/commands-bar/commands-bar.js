import template from './commands-bar.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { refresh, openDrawer } from 'actions';
import { sleep } from 'utils/all';

class CommandBarViewModel extends Disposable {
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
