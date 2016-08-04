import template from './pool-nodes-table.html';
import NodeRowViewModel from './node-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { paginationPageSize, inputThrottle } from 'config';
import { deepFreeze, throttle} from 'utils';
import { redirectTo } from 'actions';
import { routeContext } from 'model';

let columns = deepFreeze([
    {
        name: 'online',
        label: 'state',
        sortable: true,
        cellTemplate: 'icon'
    },
    {
        name: 'name',
        label: 'node name',
        sortable: true,
        cellTemplate: 'link'
    },
    {
        name: 'ip',
        sortable: true
    },
    {
        name: 'used',
        label: 'used capacity',
        sortable: true,
        cellTemplate: 'capacity'
    },
    {
        name: 'trustLevel'
    },
    {
        name: 'dataActivity'
    }
]);

class PoolNodesTableViewModel extends Disposable {
    constructor({ pool, nodeList }) {
        super();

        let query = ko.pureComputed(
            () => routeContext().query
        );

        this.poolName = ko.pureComputed(
            () => pool() && pool().name
        );

        this.columns = columns;

        this.nodes = ko.pureComputed(
            () => nodeList() && nodeList().nodes
        );

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: query().sortBy,
                order: Number(query().order)
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

        this.issuesOnly = ko.pureComputed({
            read: () => Boolean(query().hasIssues),
            write: value => this.toggleIssues(value)
        });

        this.issuesFilterOptions = [
            {
                label: ko.pureComputed(
                    () => `All Nodes (${
                        nodeList() ? nodeList().filter_counts.count : 'N/A'
                    })`
                ),
                value: false
            },
            {
                label: ko.pureComputed(
                    () => `Issues (${
                        nodeList() ? nodeList().filter_counts.has_issues : 'N/A'
                    })`
                ),
                value: true
            }
        ];

        this.page = ko.pureComputed({
            read: () => Number(query().page) || 0,
            write:  page => this.pageTo(page)
        });

        this.nameOrIpFilter = ko.pureComputed({
            read: () => query().filter,
            write: throttle(phrase => this.filterObjects(phrase), inputThrottle)
        });

        this.dataAccessOptions = [
            { value: 'FULL_ACCESS', label: 'Read & Write' },
            { value: 'READ_ONLY', label: 'Read Only' },
            { value: 'NO_ACCESS', label: 'No Access' }
        ];

        this.isAssignNodesDisabled = ko.pureComputed(
            () => Boolean(pool() && pool().demo_pool)
        );

        this.assignNodeTooltip = ko.pureComputed(
            () => this.isAssignNodesDisabled() &&
                'Node assigment in not supported for demo pool'
        );

        this.isAssignNodeModalVisible = ko.observable(false);
    }

    createNodeRow(node) {
        return new NodeRowViewModel(node);
    }

    pageTo(page) {
        let params = Object.assign(
            {
                filter: this.nameOrIpFilter(),
                hasIssues: this.issuesOnly() || undefined,
                page: page
            },
            this.sorting()
        );

        redirectTo(undefined, undefined, params);
    }

    filterObjects(phrase) {
        let params = Object.assign(
            {
                filter: phrase || undefined,
                hasIssues: this.issuesOnly() || undefined,
                page: 0
            },
            this.sorting()
        );

        redirectTo(undefined, undefined, params);
    }

    orderBy(sorting) {
        let params = Object.assign(
            {
                filter: this.nameOrIpFilter(),
                hasIssues: this.issuesOnly() || undefined,
                page: 0
            },
            sorting
        );

        redirectTo(undefined, undefined, params);
    }

    toggleIssues(value) {
        let params = Object.assign(
            {
                filter: this.nameOrIpFilter(),
                hasIssues: value || undefined,
                page: 0
            },
            this.sorting()
        );

        redirectTo(undefined, undefined, params);
    }

    showAssignNodesModal() {
        this.isAssignNodeModalVisible(true);
    }

    hideAssignNodesModal() {
        this.isAssignNodeModalVisible(false);
    }
}

export default {
    viewModel: PoolNodesTableViewModel,
    template: template
};
