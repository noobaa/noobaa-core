import template from './commands-bar.html';
import StateAwareViewModel from 'components/state-aware-view-model';
import ko from 'knockout';
import { refresh } from 'actions';
import { openDrawer, getUnreadAlertsCount } from 'dispatchers';
import { sleep } from 'utils/promise-utils';

class CommandBarViewModel extends StateAwareViewModel {
    constructor() {
        super();

        this.isRefreshSpinning = ko.observable(false);
        this.unreadAlertsCount = ko.observable();

        getUnreadAlertsCount();
    }

    onState({ alerts }) {
        this.unreadAlertsCount(alerts.unreadCount);
    }

    refresh() {
        refresh();

        this.isRefreshSpinning(true);
        sleep(1000, false).then(this.isRefreshSpinning);
    }

    showAuditLog() {
        openDrawer('audit-pane');
    }

    showAlerts() {
        openDrawer('alerts-pane');
    }
}

export default {
    viewModel: CommandBarViewModel,
    template: template
};
