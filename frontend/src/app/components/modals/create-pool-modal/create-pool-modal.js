/* Copyright (C) 2016 NooBaa */

import template from './create-pool-modal.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze, union, sumBy, throttle, memoize, pick } from 'utils/core-utils';
import { formatSize, sumSize } from 'utils/size-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getFormValues, isFormValid, getFieldValue, isFieldTouched } from 'utils/form-utils';
import { unassignedRegionText } from 'utils/resource-utils';
import { paginationPageSize, inputThrottle } from 'config';
import ko from 'knockout';
import numeral from 'numeral';
import {
    getHostModeListForStates,
    getHostDisplayName,
    getHostStateIcon,
    getNodeOrHostCapacityBarValues
} from 'utils/host-utils';
import {
    fetchHosts,
    updateForm,
    touchForm,
    updateModal,
    closeModal,
    dropHostsView,
    createHostsPool
} from 'action-creators';

const steps = deepFreeze([
    {
        label: 'Choose Name',
        size: 'small'
    },
    {
        label: 'Assign Nodes',
        size: 'auto-height'
    }
]);

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
    }
]);

const filterFields = deepFreeze([
    'nameFilter',
    'selectedPools',
    'selectedStates',
    'sorting',
    'page'
]);

const valueFieldsByStep = deepFreeze({
    0: [ 'poolName' ],
    1: [ 'selectedHosts' ]
});

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

function _validatedName(name = '', existing) {
    return [
        {
            valid: 3 <= name.length && name.length <= 63,
            message: '3-63 characters'
        },
        {
            valid: /^[a-z0-9].*[a-z0-9]$/.test(name),
            message: 'Starts and ends with a lowercase letter or number'
        },
        {
            valid: name && /^[a-z0-9.-]*$/.test(name) &&
                !name.includes(' ') &&
                !name.includes('..') &&
                !name.includes('.-') &&
                !name.includes('-.') &&
                !name.includes('--'),
            message: 'Only lowercase letters, numbers, nonconsecutive periods or hyphens'
        },
        {
            valid: name && !/^\d+\.\d+\.\d+\.\d+$/.test(name),
            message: 'Avoid the form of an IP address'
        },
        {
            valid: name && !existing.includes(name),
            message: 'Globally unique name'
        }
    ];
}

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

function _mapHostToRow(host, pools, selectedHosts) {
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
        }
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

class CreatePoolModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    columns = columns;
    steps = steps.map(step => step.label);
    stateOptions = stateOptions;
    lastQuery = '';
    modalSize = '';
    isStepValid = false;
    pageSize = paginationPageSize;
    poolNames = [];
    visibleHosts = [];
    selectedHosts = [];
    nameRestrictionList = ko.observableArray();
    fetching = ko.observable();
    poolOptions = ko.observableArray();
    selectedMessage = ko.observable();
    filteredHostCount = ko.observable();
    emptyMessage = ko.observable();
    fields = ko.observable();
    rows = ko.observableArray()
        .ofType(RowViewModel, { table: this });

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

    onState(state, params) {
        super.onState(state, params);

        const form = state.forms[this.formName];
        if (form) {
            this.fetchHosts(form);
            this.updateModalSize(form);
        }
    }

    fetchHosts(form) {
        if (getFieldValue(form, 'step') !== 1) {
            return;
        }

        const filters = pick(getFormValues(form), filterFields);
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
                limit: paginationPageSize
            }));
        }
    }

    updateModalSize(form) {
        const { size } = steps[getFieldValue(form, 'step')];
        if (this.modalSize !== size) {
            this.modalSize = size;
            this.dispatch(updateModal({ size }));
        }
    }

    selectState(state) {
        return [
            state.hostPools,
            this.selectHosts(state.hosts),
            state.forms[this.formName]
        ];
    }

    mapStateToProps(pools, hosts, form) {
        if (!pools || !hosts) {
            ko.assignToProps(this, {
                fetching: true
            });

        } else {
            const selectedHosts = form ? getFieldValue(form, 'selectedHosts') : [];
            const poolName = form ? getFieldValue(form, 'poolName'): '';
            const isPoolNameTouched = form ? isFieldTouched(form, 'poolName') : false;
            const poolList = Object.values(pools);
            const poolNames = poolList.map(pool => pool.name);
            const validationResults = form ? _validatedName(poolName, poolNames) : [];
            const hostCount = sumBy(poolList, pool => pool.hostCount);

            ko.assignToProps(this, {
                fetching: hosts.fetching,
                poolNames: poolNames,
                visibleHosts: hosts.list.map(host => host.name),
                nameRestrictionList: validationResults.map(record => ({
                    label: record.message,
                    css: isPoolNameTouched ? (record.valid ? 'success' : 'error') : ''
                })),
                poolOptions: poolList.map(_mapPoolToOption),
                emptyMessage: hostCount === 0 ?
                    'The system contains no nodes' :
                    'Current filter does not match any node',
                selectedMessage: `${selectedHosts.length} selected of all nodes (${hostCount})`,
                selectedHosts: selectedHosts,
                filteredHostCount: hosts.nonPaginatedCount,
                isStepValid: form ? isFormValid(form) : false,
                rows: hosts.list.map(host => _mapHostToRow(
                    host,
                    pools,
                    selectedHosts
                )),
                fields: !form ? {
                    step: 0,
                    poolName: '',
                    nameFilter: '',
                    selectedPools: poolList.map(pool => pool.name),
                    selectedStates: stateOptions.map(option => option.value),
                    sorting: { sortBy: 'name', order: 1 },
                    page: 0,
                    selectedHosts: []
                } : undefined
            });
        }
    }

    onPoolName = throttle(
        poolName => this.dispatch(updateForm(this.formName, { poolName })),
        inputThrottle,
        this
    );

    onNameFilter = throttle(
        nameFilter => this.dispatch(updateForm(this.formName, { nameFilter })),
        inputThrottle,
        this
    );

    onValidate({ step, poolName }) {
        const errors = {};

        if (step === 0) {
            const hasNameErrors = _validatedName(poolName, this.poolNames)
                .some(({ valid }) => !valid);

            if (hasNameErrors) {
                errors.poolName = '';
            }

        }

        return errors;
    }

    onToggleHost(host, isSelected) {
        const selectedHosts = isSelected ?
            [...this.selectedHosts, host] :
            this.selectedHosts.filter(name => name !== host);

        this.dispatch(updateForm(this.formName, { selectedHosts }));
    }

    onSelectAll() {
        const selectedHosts = union(this.selectedHosts, this.visibleHosts);
        this.dispatch(updateForm(this.formName, { selectedHosts }));
    }

    onClearAll() {
        const selectedHosts = this.selectedHosts
            .filter(host => !this.visibleHosts.includes(host));

        this.dispatch(updateForm(this.formName, { selectedHosts }));
    }

    onClearSelection() {
        this.dispatch(updateForm(this.formName, { selectedHosts: [] }));
    }

    onBeforeStep(step) {
        if (!this.isStepValid) {
            this.dispatch(touchForm(this.formName, valueFieldsByStep[step]));
            return false;
        }

        return true;
    }

    onSubmit({ poolName, selectedHosts }) {
        this.dispatch(
            createHostsPool(poolName, selectedHosts),
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
    viewModel: CreatePoolModalViewModel,
    template: template
};
