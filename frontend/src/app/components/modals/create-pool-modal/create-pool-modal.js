/* Copyright (C) 2016 NooBaa */

import template from './create-pool-modal.html';
import Observer from 'observer';
import HostRowViewModel from './host-row';
import { state$, action$ } from 'state';
import { deepFreeze, union, equalItems, sumBy, throttle } from 'utils/core-utils';
import { formatSize, sumSize } from 'utils/size-utils';
import { getHostModeListForState } from 'utils/host-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getFormValues, isFormValid, isFieldTouched } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
import { paginationPageSize, inputThrottle } from 'config';
import ko from 'knockout';
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

const allPoolsOption = deepFreeze({
    label: 'All Node Pools',
    value: 'ALL'
});

const fieldsByStep = deepFreeze({
    0: [ 'poolName' ],
    1: [ 'selectedHosts' ]
});

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

function _fetchHosts(formName, queryFields) {
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
    const pools = selectedPools === 'ALL' ? undefined : [ selectedPools ];
    const modes = _getModesFromStateFlags(showHealthy, showIssues, showOffline);
    const skip = page * paginationPageSize;
    const limit = paginationPageSize;

    action$.next(fetchHosts(
        formName,
        { pools, name, modes, sortBy, order, skip, limit }
    ));
}

class CreatePoolModalViewModel extends Observer {
    formName = this.constructor.formName;
    steps = steps.map(step => step.label);
    nameRestrictionList = ko.observableArray();
    columns = columns;
    pageSize = paginationPageSize;
    poolNames = [];
    visibleHosts = [];
    query = [];
    modalSize = '';
    fetching = ko.observable();
    poolOptions = ko.observableArray();
    rows = ko.observableArray();
    selectedMessage = ko.observable();
    filteredHostCount = ko.observable();
    emptyMessage = ko.observable();
    fields = {
        step: 0,
        poolName: '',
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
    hostRowParams = {
        onToggle: this.onToggleHost.bind(this)
    };
    onPoolNameThrottled = throttle(
        this.onPoolName,
        inputThrottle,
        this
    );
    onNameFilterThrottled = throttle(
        this.onNameFilter,
        inputThrottle,
        this
    );

    constructor() {
        super();

        // Connect to the state tree.
        this.observe(
            state$.pipe(getMany(
                'hostPools',
                'hosts',
                ['forms', this.formName]
            )),
            this.onState
        );
    }

    onState([ pools, hosts, form ]) {
        if (!pools || !hosts || !form) return;

        // Extract the form values.
        const formValues = getFormValues(form);
        const { selectedHosts, poolName } = formValues;

        // Get name restriction list.
        const poolList = Object.values(pools);
        const poolNames = poolList.map(pool => pool.name);
        const nameRestrictionList = _validatedName(poolName, poolNames)
            .map(({ valid, message }) => ({
                label: message,
                css: isFieldTouched(form, 'poolName') ? (valid ? 'success' : 'error') : ''
            }));

        // Get the pool options.
        const poolOptions = [
            allPoolsOption,
            ...poolList.map(_getPoolOption)
        ];

        // Get updated host table rows.
        const { items, queries, views } = hosts;
        const queryKey = views[this.formName];
        const result = queryKey && queries[queryKey].result;
        const hostList = result ? result.items.map(name => items[name]) : [];
        const rows = hostList.map((host, i) => {
            const row = this.rows()[i] || new HostRowViewModel(this.hostRowParams);
            row.onHost(host, selectedHosts, ko.unwrap(this.targetPool));
            return row;
        });

        // Calculate extra information.
        const hostCount = sumBy(poolList, pool => pool.hostCount);
        const selectedMessage = `${selectedHosts.length} selected of all nodes (${hostCount})`;
        const filteredHostCount = result ? result.counters.nonPaginated : 0;
        const emptyMessage = hostCount === 0 ?
            'The system contains no nodes' :
            'Current filter does not match any node';

        // Start a new fetch if needded.
        const { sortBy, order } = formValues.sorting;
        const query = [formValues.nameFilter, formValues.selectedPools, formValues.showHealthy,
            formValues.showIssues, formValues.showOffline, sortBy, order, formValues.page];

        if (!equalItems(this.query, query)) {
            this.query = query;
            _fetchHosts(this.formName, formValues, this.targetPool);
        }

        // Update the view's observables.
        this.poolNames = poolNames;
        this.visibleHosts = hostList.map(host => host.name);
        this.nameRestrictionList(nameRestrictionList);
        this.poolOptions(poolOptions);
        this.emptyMessage(emptyMessage);
        this.selectedMessage(selectedMessage);
        this.fetching(!result);
        this.filteredHostCount(filteredHostCount);
        this.rows(rows);
        this.selectedHosts = selectedHosts;
        this.isStepValid = isFormValid(form);

        // Match the modal isze woth the current step.
        const size = steps[formValues.step].size;
        if (this.modalSize !== size) {
            action$.next(updateModal({ size }));
            this.modalSize = size;
        }
    }

    onPoolName(poolName) {
        action$.next(updateForm(this.formName, { poolName }));
    }

    onNameFilter(nameFilter) {
        action$.next(updateForm(this.formName, { nameFilter }));
    }

    onValidate({ step, poolName, selectedHosts }) {
        const errors = {};

        if (step === 0) {
            const hasNameErrors = _validatedName(poolName, this.poolNames)
                .some(({ valid }) => !valid);

            if (hasNameErrors) {
                errors.poolName = '';
            }

        } else if (!selectedHosts.length) {
            errors.selectedHosts = 'Please select at least one node';
        }

        return errors;
    }

    onToggleHost(host, select) {
        const { selectedHosts } = this;
        if (!select) {
            const filtered = selectedHosts.filter(name => name !== host);
            action$.next(updateForm(this.formName, { selectedHosts: filtered }));

        } else if (!selectedHosts.includes(host)) {
            const updated = [ ...selectedHosts, host ];
            action$.next(updateForm(this.formName, { selectedHosts: updated }));
        }
    }

    onSelectAll() {
        const { selectedHosts } = this;
        const merged = union(selectedHosts, this.visibleHosts);
        action$.next(updateForm(this.formName, { selectedHosts: merged }));
    }

    onClearAll() {
        const { selectedHosts } = this;
        const filtered = selectedHosts
            .filter(host => !this.visibleHosts.includes(host));

        action$.next(updateForm(this.formName, { selectedHosts: filtered }));
    }

    onClearSelection() {
        action$.next(updateForm(this.formName, { selectedHosts: [] }));
    }

    onBeforeStep(step) {
        if (!this.isStepValid) {
            action$.next(touchForm(this.formName, fieldsByStep[step]));
            return false;
        }

        return true;
    }

    onSubmit({ poolName, selectedHosts }) {
        action$.next(createHostsPool(poolName, selectedHosts));
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
    viewModel: CreatePoolModalViewModel,
    template: template
};
