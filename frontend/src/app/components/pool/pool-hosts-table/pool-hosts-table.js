/* Copyright (C) 2016 NooBaa */

import template from './pool-hosts-table.html';
import HostRowViewModel from './host-row';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze, throttle, flatMap } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { summrizeHostModeCounters, getHostModeListForState } from 'utils/host-utils';
import { get } from 'rx-extensions';
import { paginationPageSize, inputThrottle } from 'config';
import * as routes from 'routes';
import {
    fetchHosts,
    openAssignHostsModal,
    openInstallNodesToPoolModal,
    openAssignRegionModal,
    requestLocation,
    dropHostsView
} from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        sortable: 'mode',
        type: 'icon'
    },
    {
        name: 'hostname',
        label: 'node name',
        sortable: 'name',
        type: 'newLink'
    },
    {
        name: 'ip',
        label: 'IP Address',
        sortable: true
    },
    {
        name: 'drives',
        label: 'Healthy Drives'
    },
    {
        name: 'services',
        type: 'service-indicators',
        sortable: true
    },
    {
        name: 'capacity',
        label: 'used capacity',
        sortable: 'used',
        type: 'capacity'
    },
    {
        name: 'dataActivity',
        sortable: 'data_activity'
    }
]);

const states = deepFreeze([
    'HEALTHY',
    'HAS_ISSUES',
    'OFFLINE'
]);

function _getStateFilterOptions(all, healthy, issues, offline) {
    return [
        {
            value: states[0],
            label: `Healthy (${numeral(healthy).format('0,0')})`
        },
        {
            value: states[1],
            label: `Issues (${numeral(issues).format('0,0')})`
        },
        {
            value: states[2],
            label: `Offline (${numeral(offline).format('0,0')})`
        }
    ];
}

class PoolHostsTableViewModel extends Observer {
    constructor() {
        super();

        this.viewName = this.constructor.name;
        this.baseRoute = '';
        this.baseHostRoute = '';
        this.poolName = '';
        this.pageSize = paginationPageSize;
        this.columns = columns;
        this.stateFilterOptions = ko.observableArray();
        this.nameFilter = ko.observable();
        this.stateFilter = ko.observableArray();
        this.page = ko.observable();
        this.sorting = ko.observable();
        this.rows = ko.observableArray();
        this.hostCount = ko.observable();
        this.emptyMessage = ko.observable();
        this.fetching = ko.observable();
        this.onFilterByNameThrottled = throttle(this.onFilterByName, inputThrottle, this);

        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );

        this.observe(
            state$.pipe(get('hosts')),
            this.onHosts
        );
    }

    onLocation({ route, params, query }) {
        const { system, pool, tab = 'nodes' } = params;
        if (!pool || tab !== 'nodes') return;

        const { name, page = 0, sortBy = 'name', order = 1 } = query;
        const state =
            (query.state === true &&  []) ||
            (query.state && query.state.split('|')) ||
            states;

        this.poolName = pool;
        this.baseRoute = realizeUri(route, { system, pool, tab }, {}, true);
        this.baseHostRoute = realizeUri(routes.host, { system, pool }, {}, true);
        this.nameFilter(name);
        this.stateFilter(state);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));

        action$.next(fetchHosts(
            this.viewName,
            {
                pools: [ pool ],
                name: name,
                modes: flatMap(state, state => getHostModeListForState(state)),
                sortBy: sortBy,
                order: Number(order),
                skip: paginationPageSize * Number(page),
                limit: paginationPageSize
            }
        ));
    }

    onHosts({ views, queries, items }) {
        const queryKey = views[this.viewName];
        if (!queryKey) {
            this.stateFilterOptions(_getStateFilterOptions(0, 0, 0, 0));
            return;
        }

        const query = queries[queryKey];
        if (query.result) {
            const { items: itemKeys, counters } = query.result;

            // Update toggle and paginator counters.
            const { all, healthy, hasIssues, offline } = summrizeHostModeCounters(counters.byMode);
            this.stateFilterOptions(_getStateFilterOptions(all, healthy, hasIssues, offline));
            this.hostCount(counters.nonPaginated);

            // Update table rows.
            const rowParams = { baseRoute: this.baseHostRoute };
            const rows = itemKeys.map((hostName, i) => {
                const row = this.rows()[i] || new HostRowViewModel(rowParams);
                row.onHost(items[hostName]);
                return row;
            });
            this.rows(rows);
            this.emptyMessage(rows.length === 0 ? 'No matching nodes' : '');
            // TODO: find a way to change empry message to support: Pool does not contain any nodes

            this.fetching(false);

        } else {
            this.rows([]);
            this.fetching(true);
            this.emptyMessage('');
        }
    }

    onFilterByName(name) {
        const page = 0;
        this.onQuery({ name, page });
    }

    onFilterByState(state) {
        const page = 0;
        this.onQuery({ state, page });
    }

    onSort({ sortBy, order }) {
        const page = 0;
        this.onQuery({ sortBy, order, page });
    }

    onPage(page) {
        this.onQuery({ page });
    }

    onQuery(query) {
        const {
            name: _name = this.nameFilter(),
            state: _state = this.stateFilter(),
            sortBy = this.sorting().sortBy,
            order = this.sorting().order,
            page = this.page()
        } = query;

        const name = _name || undefined;
        const state = _state.join('|');

        const url = realizeUri(this.baseRoute, {}, { name, state, sortBy, order, page });
        action$.next(requestLocation(url));
    }

    onAssignNodes() {
        action$.next(openAssignHostsModal(this.poolName));
    }

    onInstallNewNodes() {
        action$.next(openInstallNodesToPoolModal(this.poolName));
    }

    onAssignRegion() {
        action$.next(openAssignRegionModal('HOSTS', this.poolName));
    }

    dispose() {
        action$.next(dropHostsView(this.viewName));
        super.dispose();
    }
}

export default {
    viewModel: PoolHostsTableViewModel,
    template: template
};
