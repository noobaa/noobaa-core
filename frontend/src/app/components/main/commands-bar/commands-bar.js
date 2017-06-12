/* Copyright (C) 2016 NooBaa */

import template from './commands-bar.html';
import Observer from 'observer';
import { state$, dispatch } from 'state';
import ko from 'knockout';
import { refresh } from 'actions';
import { sleep } from 'utils/promise-utils';
import { sumBy } from 'utils/core-utils';
import {
    openAuditDrawer,
    openAlertsDrawer,
    fetchUnreadAlertsCount
} from 'action-creators';

class CommandBarViewModel extends Observer {
    constructor() {
        super();

        this.isRefreshSpinning = ko.observable(false);
        this.unreadAlertsCount = ko.observable();

        this.observe(state$.get('alerts', 'unreadCounts'), this.onUnreadCounts);

        dispatch(fetchUnreadAlertsCount());
    }

    onUnreadCounts(counts) {
        const total = sumBy(Object.values(counts));
        this.unreadAlertsCount(total);
    }

    refresh() {
        refresh();

        this.isRefreshSpinning(true);
        sleep(1000, false).then(this.isRefreshSpinning);
    }

    showAuditLog() {
        dispatch(openAuditDrawer());
    }

    showAlerts() {
        dispatch(openAlertsDrawer());
    }
}

export default {
    viewModel: CommandBarViewModel,
    template: template
};
