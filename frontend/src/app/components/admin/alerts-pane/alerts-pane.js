import template from './alerts-pane.html';
import StateListener from 'state-listener';
import AlertRowViewModel from './alert-row';
import ko from 'knockout';
import { fetchAlerts, updateAlerts, dropAlertsState } from 'dispatchers';
import { deepFreeze, last } from 'utils/core-utils';
import { infinitScrollPageSize } from 'config';

const severityOptions = deepFreeze([
    { label: 'all', value: 'ALL' },
    { label: 'critical', value: 'CRIT' },
    { label: 'important', value: 'MAJOR' },
    { label: 'minor', value: 'INFO' }
]);

class AlertsPaneViewModel extends StateListener {
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
        this.i = 0;

        ko.group(this.severityFilter, this.unreadOnlyFilter)
            .subscribe(() => this.onFilter());

        this.scroll.subscribe(() => this.onScroll());
    }

    stateEventsFilter(state) {
        return [ state.alerts ];
    }

    onState({ alerts }) {
        const { filter, loading, endOfList, list, loadError } = alerts;
        const { severity, read } = filter;

        // Update the view model state.
        this.severityFilter(severity || 'ALL');
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
    }

    onX() {
        this.onClose();
    }

    onFilter() {
        const read = this.unreadOnlyFilter() ? false : undefined;
        const severity = this.severityFilter() !== 'ALL' ?
            this.severityFilter() :
            undefined;


        fetchAlerts({ severity, read }, infinitScrollPageSize);
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
        updateAlerts({ ids, read: false }, true);
    }

    markListAsRead() {
        const severity = this.severityFilter() !== 'ALL' ?
            this.severityFilter() :
            undefined;

        updateAlerts({ severity, read: false }, true);
    }

    dispose() {
        super.dispose();
        dropAlertsState();
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

        fetchAlerts({ severity, read, till }, infinitScrollPageSize);
    }
}

export default {
    viewModel: AlertsPaneViewModel,
    template: template
};
