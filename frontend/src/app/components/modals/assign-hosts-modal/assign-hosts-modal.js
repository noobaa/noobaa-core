/* Copyright (C) 2016 NooBaa */

import template from './assign-hosts-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze, memoize, union, sumBy, throttle } from 'utils/core-utils';
import { formatSize, sumSize } from 'utils/size-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getFormValues, getFieldValue } from 'utils/form-utils';
import { inputThrottle, paginationPageSize } from 'config';
import { unassignedRegionText } from 'utils/resource-utils';
import {
    getHostModeListForStates,
    getHostDisplayName,
    getHostStateIcon,
    getNodeOrHostCapacityBarValues
} from 'utils/host-utils';
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

const stateOptions = deepFreeze([
    {
        label: 'Healthy Nodes',
        value: 'HEALTHY'
    },
    {
        label: 'Nodes with issues',
        value: 'HAS_ISSUES'
    },
    {
        label: 'Offline Nodes',
        value: 'OFFLINE'
    }
]);

function _mapPoolToOption({ name, hostCount, storage }) {
    const { total, free: availableFree, unavailableFree } = storage;
    const free = sumSize(availableFree, unavailableFree);
    const remark = `${formatSize(free)} of ${formatSize(total)} Available`;
    const tooltip = hostCount > 0 ?
        `${stringifyAmount('node', hostCount)} in pool` :
        'Pool is empty';

    return {
        tooltip: tooltip,
        label: name,
        value: name,
        icon: 'nodes-pool',
        remark: remark
    };
}

function _getTableEmptyMessage(hostCount, otherPoolsHostsCount) {
    if (hostCount === 0) {
        return 'The system contains no nodes';
    } else if (otherPoolsHostsCount === 0) {
        return 'All nodes are already in this pool';
    } else {
        return 'Current filter does not match any node';
    }
}

function _mapHostToRow(host, pools, selectedHosts, targetPoolName) {
    const pool = pools[host.pool];
    return {
        name: host.name,
        isSelected: selectedHosts.includes(host.name),
        displayName: getHostDisplayName(host.name),
        state: getHostStateIcon(host),
        ip: host.ip,
        capacity: getNodeOrHostCapacityBarValues(host),
        pool: {
            text: host.pool,
            tooltip: {
                template: 'propertySheet',
                text: [
                    {
                        label: 'Healthy Nodes',
                        value: `${
                            numeral(pool.hostsByMode.OPTIMAL).format(',')
                        } / ${
                            numeral(pool.hostCount).format(',')
                        }`
                    },
                    {
                        label: 'Region',
                        value: pool.region || unassignedRegionText
                    },
                    {
                        label: 'Free capacity',
                        value: formatSize(sumSize(
                            pool.storage.free,
                            pool.storage.unavailableFree
                        ))
                    }
                ]
            }
        },
        recommended: host.suggestedPool === targetPoolName ? 'yes' : '---'
    };
}

class RowViewModel {
    table = null;
    name = '';
    displayName = ko.observable();
    state = ko.observable();
    ip = ko.observable();
    capacity = ko.observable();
    pool = ko.observable();
    recommended = ko.observable();
    isSelected = ko.observable();

    // This pure computed is used to bound the checkbox column.
    selected = ko.pureComputed({
        read: this.isSelected,
        write: this.onToggle,
        owner: this
    });

    constructor({ table }) {
        this.table = table;
    }

    onToggle(selected) {
        this.table.onToggleHost(this.name, selected);
    }
}

class AssignHostsModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    fields = ko.observable();
    stateOptions = stateOptions;
    columns = columns;
    poolName = '';
    lastQuery = '';
    pageSize = paginationPageSize;
    selectedHosts = [];
    visibleHosts = [];
    poolOptions = ko.observableArray();
    emptyMessage = ko.observable();
    selectedMessage = ko.observable();
    fetching = ko.observable();
    filteredHostCount = ko.observableArray();
    rows = ko.observableArray()
        .ofType(RowViewModel, { table: this });

    onState(state, params) {
        super.onState(state, params);
        this.fetchHosts(state.forms[this.formName], params.targetPool);
    }

    fetchHosts(form, pool) {
        if (!form) return;

        const {
            selectedHosts: _,
            ...filters
        } = getFormValues(form);

        const query = JSON.stringify(filters);
        if (this.lastQuery !== query) {
            this.lastQuery = query;
            this.dispatch(fetchHosts(this.formName, {
                pools: filters.selectedPools,
                name: filters.nameFilter || undefined,
                modes: getHostModeListForStates(...filters.selectedStates),
                sortBy: filters.sorting.sortBy,
                order: filters.sorting.order,
                skip: filters.page * paginationPageSize,
                limit: paginationPageSize,
                recommendedHint: pool
            }));
        }
    }

    selectHosts = memoize(hostsState => {
        const { items, queries, views } = hostsState;
        const queryKey = views[this.formName];
        const { result } = queryKey ? queries[queryKey] : {};

        return {
            list: result ? result.items.map(name => items[name]) : [],
            fetching: !result,
            nonPaginatedCount: result ? result.counters.nonPaginated : 0
        };
    });

    selectState(state, params) {
        return [
            params.targetPool,
            state.hostPools,
            this.selectHosts(state.hosts),
            state.forms[this.formName]
        ];
    }

    mapStateToProps(poolName, pools, hosts, form) {
        if (!pools || !hosts) {
            ko.assignToProps(this, {
                fetching: true
            });

        } else {
            const { [poolName]: pool, ...other } = pools;
            const otherPools = Object.values(other);
            const selectedHosts = form ? getFieldValue(form, 'selectedHosts') : [];
            const hostCount = sumBy(Object.values(pools), pool => pool.hostCount);
            const otherPoolsHostsCount = hostCount - pool.hostCount;

            ko.assignToProps(this, {
                poolName: poolName,
                fetching: hosts.fetching,
                selectedHosts: selectedHosts,
                visibleHosts: hosts.list.map(host => host.name),
                poolOptions: otherPools.map(_mapPoolToOption),
                emptyMessage: _getTableEmptyMessage(hostCount, otherPoolsHostsCount),
                selectedMessage: `${selectedHosts.length} selected of all nodes (${otherPoolsHostsCount})`,
                filteredHostCount: hosts.nonPaginatedCount,
                rows: hosts.list.map(host => _mapHostToRow(
                    host,
                    pools,
                    selectedHosts,
                    poolName
                )),
                fields: !form ? {
                    nameFilter: '',
                    selectedPools: otherPools.map(pool => pool.name),
                    selectedStates: stateOptions.map(option => option.value),
                    sorting: { sortBy: 'name', order: 1 },
                    page: 0,
                    selectedHosts: []
                } : undefined
            });
        }
    }

    onNameFilter = throttle(
        nameFilter => this.dispatch(updateForm(this.formName, { nameFilter })),
        inputThrottle
    );

    onToggleHost(host, isSelected) {
        const selectedHosts = isSelected ?
            [...this.selectedHosts, host] :
            this.selectedHosts.filter(name => name !== host);

        this.dispatch(updateForm(this.formName, { selectedHosts }));
    }

    onSelectAll() {
        const merged = union(this.selectedHosts, this.visibleHosts);
        this.dispatch(updateForm(this.formName, { selectedHosts: merged }));
    }

    onClearAll() {
        const filtered = this.selectedHosts
            .filter(host => !this.visibleHosts.includes(host));

        this.dispatch(updateForm(this.formName, { selectedHosts: filtered }));
    }

    onClearSelection() {
        this.dispatch(updateForm(this.formName, { selectedHosts: [] }));
    }

    onSubmit({ selectedHosts }) {
        this.dispatch(
            assignHostsToPool(this.poolName, selectedHosts),
            closeModal()
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    dispose() {
        this.dispatch(dropHostsView(this.formName));
        super.dispose();
    }
}

export default {
    viewModel: AssignHostsModalViewModel,
    template: template
};
