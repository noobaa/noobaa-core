/* Copyright (C) 2016 NooBaa */

import template from './create-pool-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import HostRowViewModel from './host-row';
import { state$, action$ } from 'state';
import { fetchHosts, dropHostsView, createHostsPool } from 'action-creators';
import { deepFreeze, union, equalItems, mapValues, sumBy } from 'utils/core-utils';
import { formatSize, sumSize } from 'utils/size-utils';
import { getHostModeListForState } from 'utils/host-utils';
import { stringifyAmount } from 'utils/string-utils';
import { paginationPageSize, inputThrottle } from 'config';
import ko from 'knockout';

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

function _fetchHosts(queryFields) {
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

    action$.onNext(fetchHosts(
        formName,
        { pools, name, modes, sortBy, order, skip, limit }
    ));
}

const formName = 'createPool';

class CreatePoolModalViewModel extends Observer {
    constructor({ onClose, onUpdateOptions }) {
        super();

        this.steps = steps.map(step => step.label);
        this.nameRestrictionList = ko.observableArray();
        this.columns = columns;
        this.close = onClose;
        this.updateOptions = onUpdateOptions;
        this.pageSize = paginationPageSize;
        this.poolNames = [];
        this.visibleHosts = [];
        this.query = [];
        this.modalSize = '';
        this.fetching = ko.observable();
        this.poolOptions = ko.observableArray();
        this.rows = ko.observableArray();
        this.selectedMessage = ko.observable();
        this.filteredHostCount = ko.observable();
        this.emptyMessage = ko.observable('Current filter does not match any node');
        this.form = new FormViewModel({
            name: formName,
            fields: {
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
            },
            groups: {
                0: [ 'poolName' ],
                1: [ 'selectedHosts' ]
            },
            onValidate: this.onValidate.bind(this),
            onSubmit: this.onSubmit.bind(this)
        });

        // Throttle the input on the pool name field.
        this.throttledPoolName = this.form.poolName
            .throttle(inputThrottle);

        // Throttle the input on the name filter field.
        this.throttledNameFilter = this.form.nameFilter
            .throttle(inputThrottle);

        // Bind the toggleHost handler because we serve it as a callback.
        this.onToggleHost = this.onToggleHost.bind(this);

        // Connect to the state tree.
        this.observe(
            state$.getMany(
                'hostPools',
                'hosts',
                ['forms', formName, 'fields']
            ),
            this.onState
        );
    }

    onState([ pools, hosts, formFields ]) {
        if (!pools || !hosts || !formFields) return;

        // Extract the form values.
        const formValues = mapValues(formFields, field => field.value);
        const { selectedHosts, poolName } = formValues;

        // Get name restriction list.
        const poolList = Object.values(pools);
        const poolNames = poolList.map(pool => pool.name);
        const nameRestrictionList = _validatedName(poolName, poolNames)
            .map(({ valid, message }) => ({
                label: message,
                css: formFields.poolName.touched ? (valid ? 'success' : 'error') : ''
            }));

        // Get the pool options.
        const poolOptions = [
            allPoolsOption,
            ...poolList.map(_getPoolOption)
        ];

        // Get updated host table rows.
        const { items, queries, views } = hosts;
        const queryKey = views[formName];
        const result = queryKey && queries[queryKey].result;
        const hostList = result ? result.items.map(name => items[name]) : [];
        const rows = hostList.map((host, i) => {
            const row = this.rows()[i] || new HostRowViewModel({ onToggle: this.onToggleHost });
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
            _fetchHosts(formValues, this.targetPool);
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

        // Match the modal isze woth the current step.
        const size = steps[formValues.step].size;
        if (this.modalSize !== size) {
            this.updateOptions({ size });
            this.modalSize = size;
        }
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
        const { selectedHosts } = this.form;
        if (!select) {
            const filtered = selectedHosts().filter(name => name !== host);
            selectedHosts(filtered);

        } else if (!selectedHosts().includes(host)) {
            selectedHosts([ ...selectedHosts(), host ]);
        }
    }

    onSelectAll() {
        const { selectedHosts } = this.form;
        const merged = union(selectedHosts(), this.visibleHosts);
        selectedHosts(merged);
    }

    onClearAll() {
        const { selectedHosts } = this.form;
        const filtered = selectedHosts()
            .filter(host => !this.visibleHosts.includes(host));

        selectedHosts(filtered);
    }

    onClearSelection() {
        this.form.selectedHosts([]);
    }

    onBeforeStep(step) {
        if (!this.form.isValid()) {
            this.form.touch(step);
            return false;
        }

        return true;
    }

    onSubmit({ poolName, selectedHosts }) {
        action$.onNext(createHostsPool(poolName, selectedHosts));
        this.close();
    }

    onCancel() {
        this.close();
    }

    dispose() {
        action$.onNext(dropHostsView(formName));
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: CreatePoolModalViewModel,
    template: template
};
