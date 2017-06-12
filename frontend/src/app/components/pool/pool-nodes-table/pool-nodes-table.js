/* Copyright (C) 2016 NooBaa */

import template from './pool-nodes-table.html';
import NodeRowViewModel from './node-row';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { paginationPageSize, inputThrottle } from 'config';
import { deepFreeze, throttle} from 'utils/core-utils';
import { navigateTo } from 'actions';
import { routeContext } from 'model';
import { countNodesByState } from 'utils/ui-utils';
import { dispatch } from 'state';
import { openAssignNodesModal } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        sortable: 'mode',
        type: 'icon'
    },
    {
        name: 'name',
        label: 'node name',
        sortable: true,
        type: 'link'
    },
    {
        name: 'ip',
        label: 'IP Address',
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

class PoolNodesTableViewModel extends BaseViewModel {
    constructor({ pool, nodeList }) {
        super();

        const query = ko.pureComputed(
            () => routeContext().query
        );

        this.poolName = ko.pureComputed(
            () => pool() && pool().name
        );

        this.columns = columns;

        this.nodes = ko.pureComputed(
            () => nodeList() && nodeList().nodes
        );

        this.nameOrIpFilter = ko.pureComputed({
            read: () => query().filter,
            write: throttle(phrase => this.filterObjects(phrase), inputThrottle)
        });


        this.stateOptions = ko.pureComputed(
            () => nodeList() ?
                this.getStateOptions(nodeList().filter_counts.by_mode) :
                []
        );
        this.stateFilter = ko.pureComputed({
            read: () => query().state || 'ALL',
            write: value => this.selectState(value)
        });

        this.page = ko.pureComputed({
            read: () => Number(query().page) || 0,
            write:  page => this.pageTo(page)
        });

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: query().sortBy || 'name',
                order: Number(query().order) || 1
            }),
            write: value => this.orderBy(value)
        });

        this.pageSize = paginationPageSize;

        this.emptyMessage = ko.pureComputed(
            () => {
                if (pool() && pool().nodes.count === 0) {
                    return 'Pool does not contain any nodes';
                }

                if (nodeList() && nodeList().nodes.length === 0) {
                    return 'No matching nodes';
                }
            }
        );

        this.count = ko.pureComputed(
            () => nodeList() && nodeList().total_count
        );

        this.isAssignNodesDisabled = ko.pureComputed(
            () => Boolean(pool() && pool().demo_pool)
        );

        this.assignNodeTooltip = ko.pureComputed(
            () => this.isAssignNodesDisabled() &&
                'Node assigment in not supported for demo pool'
        );
    }

    getStateOptions(modeCounters) {
        const stateCounters = countNodesByState(modeCounters);

        return [
            {
                value: 'ALL',
                label: `All Nodes (${stateCounters.all})`
            },
            {
                value: 'HEALTHY',
                label: `Healthy (${stateCounters.healthy})`
            },
            {
                value: 'HAS_ISSUES',
                label: `Issues (${stateCounters.hasIssues})`
            },
            {
                value: 'OFFLINE',
                label: `Offline (${stateCounters.offline})`
            }
        ];
    }

    createNodeRow(node) {
        return new NodeRowViewModel(node);
    }

    pageTo(page) {
        const filter = this.nameOrIpFilter();
        const state = this.stateFilter();
        const { sortBy, order } = this.sorting();
        const params = { filter, state, sortBy, order, page };

        navigateTo(undefined, undefined, params);
    }

    filterObjects(phrase) {
        const filter = phrase || undefined;
        const state = this.stateFilter();
        const { sortBy, order } = this.sorting();
        const page = 0;
        const params = { filter, state, sortBy, order, page };

        navigateTo(undefined, undefined, params);
    }

    orderBy(sorting) {
        const filter = this.nameOrIpFilter();
        const state = this.stateFilter();
        const { sortBy, order } = sorting;
        const page = 0;
        const params = { filter, state, sortBy, order, page };

        navigateTo(undefined, undefined, params);
    }

    selectState(value) {
        const filter = this.nameOrIpFilter();
        const state = value !== 'ALL' ? value : undefined;
        const { sortBy, order } = this.sorting();
        const page = 0;
        const params = { filter, state, sortBy, order, page };

        navigateTo(undefined, undefined, params);
    }

    toggleIssues(value) {
        const params = Object.assign(
            {
                filter: this.nameOrIpFilter(),
                hasIssues: value || undefined,
                page: 0
            },
            this.sorting()
        );

        navigateTo(undefined, undefined, params);
    }

    onAssignNodes() {
        dispatch(openAssignNodesModal(this.poolName()));
    }
}

export default {
    viewModel: PoolNodesTableViewModel,
    template: template
};
