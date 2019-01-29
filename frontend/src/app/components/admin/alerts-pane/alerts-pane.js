/* Copyright (C) 2016 NooBaa */

import template from './alerts-pane.html';
import Observer from 'observer';
import AlertRowViewModel from './alert-row';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze, last, sumBy } from 'utils/core-utils';
import { get } from 'rx-extensions';
import { infinitScrollPageSize } from 'config';
import { fetchAlerts, updateAlerts, dropAlerts, fetchUnreadAlertsCount } from 'action-creators';

const severityOptions = deepFreeze([
    {
        label: 'all',
        value: 'ALL'
    },
    {
        label: 'critical',
        value: 'CRIT'
    },
    {
        label: 'important',
        value: 'MAJOR' },
    {
        label: 'minor',
        value: 'INFO'
    }
]);

class AlertsPaneViewModel extends Observer {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
        this.loading = ko.observable();
        this.markAllDisabled = ko.observable();
        this.loadFailed = ko.observable();
        this.endOfList = ko.observable();
        this.severityOptions = severityOptions;
        this.rows = ko.observableArray();
        this.severityFilter = ko.observable();
        this.unreadOnlyFilter = ko.observable();
        this.scroll = ko.observable();
        this.unreadCheckboxLabel = ko.observable();

        ko.group(this.severityFilter, this.unreadOnlyFilter)
            .subscribe(() => this.onFilter());

        this.scroll.subscribe(() => this.onScroll());

        this.observe(
            state$.pipe(get('alerts')),
            this.onAlerts
        );

        action$.next(fetchUnreadAlertsCount());
    }

    onAlerts(alerts) {
        const { filter, loading, endOfList, list, loadError, unreadCounts } = alerts;
        const { severity = 'ALL', read } = filter;



        // Update the view model state.
        this.severityFilter(severity);
        this.unreadOnlyFilter(read === false);
        this.loading(loading);
        this.loadFailed(Boolean(loadError));
        this.markAllDisabled(loading || list.length === 0);
        this.endOfList(endOfList);
        this.rows(
            list.map(
                (alert, i) => {
                    const row = this.rows()[i] || new AlertRowViewModel();
                    row.update(alert);
                    return row;
                }
            )
        );

        const totalCount = sumBy(Object.values(unreadCounts));
        const { [severity.toLowerCase()]: count = totalCount } = unreadCounts;
        this.unreadCheckboxLabel(`Show Unread Only (${count})`);
    }

    onX() {
        this.onClose();
    }

    onFilter() {
        const read = this.unreadOnlyFilter() ? false : undefined;
        const severity = this.severityFilter() !== 'ALL' ?
            this.severityFilter() :
            undefined;


        action$.next(fetchAlerts({ severity, read }, infinitScrollPageSize));
        this.scroll(0);
    }

    onScroll() {
        if (!this.loadFailed() && this.scroll() > .99 ) {
            this._loadMore();
        }
    }

    retryLoad() {
        this._loadMore();
    }

    markRowAsRead(row) {
        const ids = [row.id()];
        action$.next(updateAlerts({ ids, read: false }, true));
    }

    markListAsRead() {
        const severity = this.severityFilter() !== 'ALL' ?
            this.severityFilter() :
            undefined;

        action$.next(updateAlerts({severity, read: false }, true));
    }

    dispose() {
        action$.next(dropAlerts());
        super.dispose();
    }

    _loadMore() {
        if (this.endOfList()) {
            return;
        }

        const rows = this.rows();
        const till = rows.length ? last(rows).id() : undefined;
        const read = this.unreadOnlyFilter() ? false : undefined;
        const severity = this.severityFilter() !== 'ALL' ?
            this.severityFilter() :
            undefined;

        action$.next(fetchAlerts({ severity, read, till }, infinitScrollPageSize));
    }
}

export default {
    viewModel: AlertsPaneViewModel,
    template: template
};
