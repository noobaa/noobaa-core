/* Copyright (C) 2016 NooBaa */

import template from './assign-hosts-modal.html';
import Observer from 'observer';
import HostRowViewModel from './host-row';
import ko from 'knockout';
import { state$, action$ } from 'state';
import { deepFreeze, union, equalItems, sumBy, throttle } from 'utils/core-utils';
import { formatSize, sumSize } from 'utils/size-utils';
import { getHostModeListForState} from 'utils/host-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getFormValues } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
import { inputThrottle, paginationPageSize } from 'config';
import {
    fetchHosts,
    updateForm,
    dropHostsView,
    assignHostsToPool,
    closeModal
} from 'action-creators';

const columns = deepFreeze([
    {
        name: 'selected',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'state',
        type: 'icon',
        sortable: 'mode'
    },
    {
        name: 'displayName',
        label: 'name',
        sortable: 'name'
    },
    {
        name: 'ip',
        label: 'IP',
        sortable: true
    },
    {
        name: 'capacity',
        label: 'used capacity',
        type: 'capacity',
        sortable: 'used'
    },
    {
        name: 'pool',
        sortable: true
    },
    {
        name: 'recommended',
        sortable: true
    }
]);

const allPoolsOption = deepFreeze({
    label: 'All Node Pools',
    value: 'ALL'
});

function _getPoolOption({ name, hostCount, storage }) {
    const { total, free: availableFree, unavailableFree } = storage;
    const free = sumSize(availableFree, unavailableFree);
    const remark = `${formatSize(free)} of ${formatSize(total)} Available`;
    const tooltip = hostCount > 0 ?
        `${stringifyAmount('node', hostCount)} in pool` :
        'Pool is empty';

    return {
        tooltip: {
            text: tooltip,
            position: 'after'
        },
        label: name,
        value: name,
        icon: 'nodes-pool',
        remark: remark
    };
}

function _getModesFromStateFlags(healthy, issues, offline) {
    return [
        ...(healthy ? getHostModeListForState('HEALTHY') : []),
        ...(issues ? getHostModeListForState('HAS_ISSUES') : []),
        ...(offline ? getHostModeListForState('OFFLINE') : [])
    ];
}

function _getTableEmptyMessage(hostCount, releventHostsCount) {
    if (hostCount === 0) {
        return 'The system contains no nodes';
    } else if (releventHostsCount === 0) {
        return 'All nodes are already in this pool';
    } else {
        return 'Current filter does not match any node';
    }
}

function _fetchHosts(formName, queryFields, poolList, targetPool) {
    const {
        nameFilter,
        selectedPools,
        showHealthy,
        showIssues,
        showOffline,
        sorting,
        page
    } = queryFields;

    const { sortBy, order } = sorting;
    const name = nameFilter || undefined;
    const pools = selectedPools === 'ALL' ? poolList : [ selectedPools ];
    const modes = _getModesFromStateFlags(showHealthy, showIssues, showOffline);
    const skip = page * paginationPageSize;
    const limit = paginationPageSize;
    const recommendedHint = sortBy === 'recommended' ? targetPool : undefined;
    const query = { pools, name, modes, sortBy, order, skip, limit, recommendedHint };

    action$.next(fetchHosts(formName, query));
}

class AssignHostsModalViewModel extends Observer {
    formName = this.constructor.name;
    columns = columns;
    pageSize = paginationPageSize;
    targetPool = '';
    visibleHosts = [];
    query = [];
    fetching = ko.observable();
    poolOptions = ko.observableArray();
    rows = ko.observableArray();
    selectedMessage = ko.observable();
    filteredHostCount = ko.observable();
    emptyMessage = ko.observable();
    onNameFilterThrottled = throttle(this.onNameFilter, inputThrottle, this);
    rowParams = { onToggle: this.onToggleHost.bind(this) };
    fields = {
        nameFilter: '',
        selectedPools: 'ALL',
        showHealthy: true,
        showIssues: false,
        showOffline: false,
        sorting: {
            sortBy: 'name',
            order: 1
        },
        page: 0,
        selectedHosts: []
    };

    constructor({ targetPool }) {
        super();

        this.targetPool = ko.unwrap(targetPool);

        this.observe(
            state$.pipe(
                getMany(
                    'hostPools',
                    'hosts',
                    ['forms', this.formName ]
                )
            ),
            this.onState
        );
    }

    onState([ pools, hosts, form ]) {
        if (!pools || !hosts || !form) return;

        // Extract the form values.
        const formValues = getFormValues(form);
        const { selectedHosts } = formValues;

        // Update pools related information.
        const allPools = Object.values(pools);
        const releventPools = allPools
            .filter(pool => pool.name !== this.targetPool);

        // Get the pool options.
        const poolOptions = [
            allPoolsOption,
            ...releventPools.map(_getPoolOption)
        ];

        // Get updated host table rows.
        const { items, queries, views } = hosts;
        const queryKey = views[this.formName];
        const result = queryKey && queries[queryKey].result;
        const hostList = result ? result.items.map(name => items[name]) : [];
        const rows = hostList.map((host, i) => {
            const row = this.rows()[i] || new HostRowViewModel(this.rowParams);
            row.onHost(host, selectedHosts, ko.unwrap(this.targetPool));
            return row;
        });

        // Calculate extra information.
        const hostCount = sumBy(allPools, pool => pool.hostCount);
        const releventHostsCount = sumBy(releventPools, pool => pool.hostCount);
        const selectedMessage = `${selectedHosts.length} selected of all nodes (${releventHostsCount})`;
        const emptyMessage = _getTableEmptyMessage(hostCount, releventHostsCount);
        const filteredHostCount = result ? result.counters.nonPaginated : 0;

        // Start a new fetch if needded.
        const { sortBy, order } = formValues.sorting;
        const query = [formValues.nameFilter, formValues.selectedPools, formValues.showHealthy,
            formValues.showIssues, formValues.showOffline, sortBy, order, formValues.page];

        if (!equalItems(this.query, query)) {
            this.query = query;
            _fetchHosts(
                this.formName,
                formValues,
                releventPools.map(pool => pool.name),
                this.targetPool
            );
        }

        // Update the view's observables.
        this.selectedHosts = selectedHosts;
        this.visibleHosts = hostList.map(host => host.name);
        this.poolOptions(poolOptions);
        this.emptyMessage(emptyMessage);
        this.selectedMessage(selectedMessage);
        this.fetching(!result);
        this.filteredHostCount(filteredHostCount);
        this.rows(rows);
    }

    onNameFilter(nameFilter) {
        action$.next(updateForm(this.formName, { nameFilter }));
    }

    onToggleHost(host, select) {
        const { selectedHosts } = this;
        if (!select) {
            const filtered = selectedHosts.filter(name => name !== host);
            action$.next(updateForm(this.formName, { selectedHosts: filtered }));

        } else if (!this.selectedHosts.includes(host)) {
            const updated = [ ...selectedHosts, host ];
            action$.next(updateForm(this.formName, { selectedHosts: updated }));
        }
    }

    onSelectAll() {
        const merged = union(this.selectedHosts, this.visibleHosts);
        action$.next(updateForm(this.formName, { selectedHosts: merged }));
    }

    onClearAll() {
        const filtered = this.selectedHosts
            .filter(host => !this.visibleHosts.includes(host));

        action$.next(updateForm(this.formName, { selectedHosts: filtered }));
    }

    onClearSelection() {
        action$.next(updateForm(this.formName, { selectedHosts: [] }));
    }

    onSubmit({ selectedHosts }) {
        action$.next(assignHostsToPool(this.targetPool, selectedHosts));
        action$.next(closeModal());
    }

    onCancel() {
        action$.next(closeModal());
    }

    dispose() {
        action$.next(dropHostsView(this.formName));
        super.dispose();
    }
}

export default {
    viewModel: AssignHostsModalViewModel,
    template: template
};
