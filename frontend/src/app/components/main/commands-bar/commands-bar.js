/* Copyright (C) 2016 NooBaa */

import template from './commands-bar.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { sumBy } from 'utils/core-utils';
import {
    openAuditDrawer,
    openAlertsDrawer,
    fetchUnreadAlertsCount,
    refreshLocation
} from 'action-creators';

class CommandBarViewModel extends ConnectableViewModel {
    isRefreshSpinning = ko.observable();
    unreadAlertsCount = ko.observable();
    location = '';

    constructor(...args) {
        super(...args);

        this.dispatch(fetchUnreadAlertsCount());
    }

    selectState(state) {
        return [
            state.alerts.unreadCounts
        ];
    }

    mapStateToProps(counters) {
        const unreadAlertsCount = counters ?
            sumBy(Object.values(counters)) :
            0;

        ko.assignToProps(this, {
            unreadAlertsCount
        });
    }

    onRefresh() {
        ko.assignToProps(this, {
            isRefreshSpinning: true
        });

        this.dispatch(refreshLocation());
    }

    onRefreshAnimationEnd() {
        ko.assignToProps(this, {
            isRefreshSpinning: false
        });
    }

    onAudit() {
        this.dispatch(openAuditDrawer());
    }

    onAlerts() {
        this.dispatch(openAlertsDrawer());
    }
}

export default {
    viewModel: CommandBarViewModel,
    template: template
};
