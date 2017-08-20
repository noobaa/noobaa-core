/* Copyright (C) 2016 NooBaa */

import template from './assign-hosts-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import HostRowViewModel from './host-row';
import { state$, action$ } from 'state';
import { fetchHosts, assignHostsToPool } from 'action-creators';
import { deepFreeze, union, equalItems, inputThrottle, mapValues, sumBy } from 'utils/core-utils';
import { formatSize, sumSize } from 'utils/size-utils';
import { getHostModeListForState} from 'utils/host-utils';
import { stringifyAmount } from 'utils/string-utils';
import { paginationPageSize } from 'config';
import ko from 'knockout';

const columns = deepFreeze([
    {
        name: 'selected',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'state',
        type: 'icon',
        sortable: 'mode',
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
    const { total, free: available_free, unavailable_free } = storage;
    const free = sumSize(available_free, unavailable_free);
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
        return 'Current filter does not match any host';
    }
}

function _fetchHosts(queryFields, poolList, targetPool) {
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

    action$.onNext(fetchHosts(
        formName,
        { pools, name, modes, sortBy, order, skip, limit, recommendedHint }
    ));
}

const formName = 'assignHosts';

class AssignHostsModalViewModel extends Observer {
    constructor({ onClose, targetPool }) {
        super();

        this.columns = columns;
        this.close = onClose;
        this.pageSize = paginationPageSize;
        this.targetPool = targetPool;
        this.visibleHosts = [];
        this.query = [];
        this.fetching = ko.observable();
        this.poolOptions = ko.observableArray();
        this.rows = ko.observableArray();
        this.selectedMessage = ko.observable();
        this.filteredHostCount = ko.observable();
        this.emptyMessage = ko.observable();
        this.form = new FormViewModel({
            name: formName,
            fields: {
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
            onSubmit: this.onSubmit.bind(this)
        });

        // Throttle the input on the name filter field.
        this.throttledNameFilter = this.form.nameFilter
            .throttle(inputThrottle);

        // Bind the toggleHost handler because we serve it as a callback.
        this.onToggleHost = this.onToggleHost.bind(this);

        this.observe(
            state$.getMany(
                ['hostPools', 'items'],
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
        const queryKey = views[formName];
        const result = queryKey && queries[queryKey].result;
        const hostList = result ? result.items.map(name => items[name]) : [];
        const rows = hostList.map((host, i) => {
            const row = this.rows()[i] || new HostRowViewModel({ onToggle: this.onToggleHost });
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
            _fetchHosts(formValues, releventPools.map(pool => pool.name), this.targetPool);
        }

        // Update the view's observables.
        this.visibleHosts = hostList.map(host => host.name);
        this.poolOptions(poolOptions);
        this.emptyMessage(emptyMessage);
        this.selectedMessage(selectedMessage);
        this.fetching(!result);
        this.filteredHostCount(filteredHostCount);
        this.rows(rows);
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

    onSubmit({ selectedHosts }) {
        action$.onNext(assignHostsToPool(this.targetPool, selectedHosts));
        this.close();
    }

    onCancel() {
        this.close();
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: AssignHostsModalViewModel,
    template: template
};
