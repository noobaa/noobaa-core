import template from './commands-bar.html';
import StateListener from 'state-listener';
import ko from 'knockout';
import { refresh } from 'actions';
import { openAuditDrawer, openAlertsDrawer, getUnreadAlertsCount } from 'dispatchers';
import { sleep } from 'utils/promise-utils';

class CommandBarViewModel extends StateListener {
    constructor() {
        super();

        this.isRefreshSpinning = ko.observable(false);
        this.unreadAlertsCount = ko.observable();

        getUnreadAlertsCount();
    }

    selectState(state) {
        return [ state.alerts ];
    }

    onState(alerts) {
        this.unreadAlertsCount(alerts.unreadCount);
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
