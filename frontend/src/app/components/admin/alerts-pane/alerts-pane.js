import template from './alerts-pane.html';
import StateAwareViewModel from 'components/state-aware-view-model';
import AlertRowViewModel from './alert-row';
import ko from 'knockout';
import { closeDrawer } from 'actions';
import { loadAlerts, filterAlerts, updateAlerts, dropAlerts } from 'dispatchers';
import { deepFreeze, last } from 'utils/core-utils';
import { infinitScrollPageSize } from 'config';

const severityOptions = deepFreeze([
    { label: 'all', value: 'ALL' },
    { label: 'critical', value: 'CRIT' },
    { label: 'important', value: 'MAJOR' },
    { label: 'minor', value: 'INFO' }
]);

class AlertsPaneViewModel extends StateAwareViewModel {
    constructor() {
        super();

        this.loading = ko.observable();
        this.loadFailed = ko.observable();
        this.endOfList = ko.observable();
        this.severityOptions = severityOptions;
        this.rows = ko.observableArray();
        this.severityFilter = ko.observable();
        this.unreadOnlyFilter = ko.observable();
        this.scroll = ko.observable();

        ko.group(this.severityFilter, this.unreadOnlyFilter)
            .subscribe(() => this.onFilter());

        this.scroll.subscribe(() => this.onScroll());
    }

    onState(state, oldState = {}) {
        // Ignore updates that are no concern for this component.
        if (state.alerts === oldState.alerts) {
            return;
        }

        const { filter, loading, endOfList, list, lastLoadError } = state.alerts;
        const { severity, read } = filter;

        // Update the view model state.
        this.severityFilter(severity || 'ALL');
        this.unreadOnlyFilter(read === false);
        this.loading(loading);
        this.loadFailed(Boolean(!loading && lastLoadError));
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

        // Check if we need more results and try loading if neccecery.
        const needMore = infinitScrollPageSize - list.length;
        if (!lastLoadError && needMore) {
            this.tryLoadMore(needMore);
        }
    }

    onScroll() {
        if (this.scroll() > .99 && !this.loadFailed()) {
            this.tryLoadMore();
        }
    }

    onFilter() {
        const read = this.unreadOnlyFilter() ? false : undefined;
        const severity = this.severityFilter() !== 'ALL' ?
            this.severityFilter() :
            undefined;


        filterAlerts({ severity, read });
        this.scroll(0);
    }

    retryLoad() {
        this.tryLoadMore();
    }

    tryLoadMore(count = infinitScrollPageSize) {
        if (this.loading() || this.endOfList()) {
            return;
        }

        const read = this.unreadOnlyFilter() ? false : undefined;
        const severity = this.severityFilter() !== 'ALL' ?
            this.severityFilter() :
            undefined;

        const rows = this.rows();
        const lastId = rows.length ? last(rows).id() : undefined;
        loadAlerts({ severity, read }, count, lastId);
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

    closeDrawer() {
        closeDrawer();
    }

    dispose() {
        super.dispose();
        dropAlerts();
    }
}

export default {
    viewModel: AlertsPaneViewModel,
    template: template
};
