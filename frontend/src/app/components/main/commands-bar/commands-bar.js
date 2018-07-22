/* Copyright (C) 2016 NooBaa */

import template from './commands-bar.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { sleep } from 'utils/promise-utils';
import { sumBy } from 'utils/core-utils';
import { get } from 'rx-extensions';
import {
    openAuditDrawer,
    openAlertsDrawer,
    fetchUnreadAlertsCount,
    refreshLocation
} from 'action-creators';

class CommandBarViewModel extends Observer {
    constructor() {
        super();

        this.isRefreshSpinning = ko.observable(false);
        this.unreadAlertsCount = ko.observable();
        this.location = '';

        this.observe(
            state$.pipe(get('alerts', 'unreadCounts')),
            this.onUnreadCounts
        );

        action$.next(fetchUnreadAlertsCount());
    }

    onUnreadCounts(counts) {
        const total = sumBy(Object.values(counts));
        this.unreadAlertsCount(total);
    }

    onRefresh() {
        action$.next(refreshLocation());

        this.isRefreshSpinning(true);
        sleep(1000, false).then(this.isRefreshSpinning);
    }

    onAudit() {
        action$.next(openAuditDrawer());
    }

    onAlerts() {
        action$.next(openAlertsDrawer());
    }
}

export default {
    viewModel: CommandBarViewModel,
    template: template
};
