import template from './pool-nodes-table.html';
import NodeRowViewModel from './node-row';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { makeArray, throttle} from 'utils';
import { redirectTo } from 'actions';
import { routeContext } from 'model';

class PoolNodesTableViewModel extends BaseViewModel {
    constructor({ pool, nodeList }) {
        super();

        this.poolName = ko.pureComputed(
            () => pool() && pool().name
        );

        this.pageSize = paginationPageSize;

        this.count = ko.pureComputed(
            () => nodeList() && nodeList().total_count
        );

        let query = ko.pureComputed(
            () => routeContext().query
        );

        this.sortedBy = ko.pureComputed(
            () => query().sortBy || 'name'
        );

        this.order = ko.pureComputed(
            () => Number(query().order) || 1
        );

        this.issuesOnly = ko.pureComputed({
            read: () => Boolean(query().hasIssues),
            write: value => this.toggleIssues(value)
        });

        this.issuesFilterOptions = [
            {
                label: ko.pureComputed(
                    () => `All Nodes (${ this.count() != null ? this.count() : 'N/A'})`
                ),
                value: false
            },
            {
                label: ko.pureComputed(
                    () => `Issues (${ pool() ? pool().nodes.has_issues : 'N/A'})`
                ),
                value: true
            }
        ];

        this.page = ko.pureComputed({
            read: () => Number(query().page) || 0,
            write:  page => this.pageTo(page)
        });

        this.filter = ko.pureComputed({
            read: () => query().filter,
            write: throttle(phrase => this.filterObjects(phrase), 750)
        });

        this.rows = makeArray(
            this.pageSize,
            i => new NodeRowViewModel(() => nodeList() && nodeList().nodes[i])
        );

        this.hasNodes = ko.pureComputed(
            () => nodeList() && nodeList().nodes.length > 0
        );

        this.dataAccessOptions = [
            { value: 'FULL_ACCESS', label: 'Read & Write' },
            { value: 'READ_ONLY', label: 'Read Only' },
            { value: 'NO_ACCESS', label: 'No Access' }
        ];

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

        this.isAssignNodeModalVisible = ko.observable(false);
    }

    showAssignNodesModal() {
        this.isAssignNodeModalVisible(true);
    }

    hideAssignNodesModal() {
        this.isAssignNodeModalVisible(false);
    }

    pageTo(page) {
        redirectTo(undefined, undefined, {
            filter: this.filter(),
            hasIssues: this.issuesOnly() || undefined,
            sortBy: this.sortedBy(),
            order: this.order(),
            page: page
        });
    }

    filterObjects(phrase) {
        redirectTo(undefined, undefined, {
            filter: phrase || undefined,
            hasIssues: this.issuesOnly() || undefined,
            sortBy: this.sortedBy(),
            order: this.order(),
            page: 0
        });
    }

    orderBy(colName) {
        redirectTo(undefined, undefined, {
            filter: this.filter(),
            hasIssues: this.issuesOnly() || undefined,
            sortBy: colName,
            order: this.sortedBy() === colName ? 0 - this.order() : 1,
            page: 0
        });
    }

    toggleIssues(value) {
        redirectTo(undefined, undefined, {
            filter: this.filter(),
            hasIssues: value || undefined,
            sortBy: this.sortedBy(),
            order: this.order(),
            page: 0
        });
    }

    orderClassFor(colName) {
        return `sortable ${
            this.sortedBy() === colName ? (this.order() === 1 ? 'des' : 'asc') : ''
        }`;
    }
}

export default {
    viewModel: PoolNodesTableViewModel,
    template: template
};
