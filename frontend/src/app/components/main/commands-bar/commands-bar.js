/* Copyright (C) 2016 NooBaa */

import template from './commands-bar.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
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

        action$.onNext(fetchUnreadAlertsCount());
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
        action$.onNext(openAuditDrawer());
    }

    showAlerts() {
        action$.onNext(openAlertsDrawer());
    }
}

export default {
    viewModel: CommandBarViewModel,
    template: template
};
