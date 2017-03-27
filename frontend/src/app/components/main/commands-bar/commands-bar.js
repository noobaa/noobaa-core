import template from './commands-bar.html';
import Observer from 'observer';
import state$ from 'state';
import ko from 'knockout';
import { refresh } from 'actions';
import { openAuditDrawer, openAlertsDrawer, getUnreadAlertsCount } from 'dispatchers';
import { sleep } from 'utils/promise-utils';

class CommandBarViewModel extends Observer {
    constructor() {
        super();

        this.isRefreshSpinning = ko.observable(false);
        this.unreadAlertsCount = ko.observable();

        this.observe(state$.get('alerts.unreadCount'), this.unreadAlertsCount);

        getUnreadAlertsCount();
    }


    refresh() {
        refresh();

        this.isRefreshSpinning(true);
        sleep(1000, false).then(this.isRefreshSpinning);
    }

    showAuditLog() {
        openAuditDrawer();
    }

    showAlerts() {
        openAlertsDrawer();
    }
}

export default {
    viewModel: CommandBarViewModel,
    template: template
};
