import template from './pool-nodes-table.html';
import NodeRowViewModel from './node-row';
import ko from 'knockout';
import { paginationPageSize } from 'config';
import { makeArray, throttle} from 'utils';
import { redirectTo } from 'actions';

const dataAccessOptions = Object.freeze([
    { value: null, label: 'All data access' },
    { value: 'FULL_ACCESS', label: 'Read & write' },
    { value: 'READ_ONLY', label: 'Read only' },
    { value: 'NO_ACCESS', label: 'No access' }
]);

const trustOptions = Object.freeze([
    { value: null, label: 'All trust levels' },
    { value: true, label: 'Trusted' },
    { value: false, label: 'Untrusted' }
]);

const stateOptions = Object.freeze([
    { value: null, label: 'All states'},
    { value: true, label: 'Online' },
    { value: false, label: 'Offline' }
]);

const activityOptions = Object.freeze([
    { value: null, label: 'All activities' },
    { value: 'EVACUATING', label: 'Evacuating' },
    { value: 'REBUILDING',  label: 'Rebuilding' },
    { value: 'MIGRATING', label: 'Migrating' }
]);


class PoolNodesTableViewModel {
    constructor({ pool, nodes }) {
        this.poolName = ko.pureComputed(
            () => pool() && pool().name
        );

        this.pageSize = paginationPageSize;
        this.count = nodes.count;
        this.sortedBy = nodes.sortedBy;
        this.order = nodes.order;

        this.page = ko.pureComputed({
            read: nodes.page,
            write:  page => this.pageTo(page)
        });

        this.filter = ko.pureComputed({
            read: nodes.filter,
            write: throttle(phrase => this.filterObjects(phrase), 750)
        });

        this.rows = makeArray(
            this.pageSize,
            i => new NodeRowViewModel(() => nodes()[i])
        );

        this.hasNodes = ko.pureComputed(
            () => nodes().length > 0
        );

        this.dataAccessOptions = [
            { value: 'FULL_ACCESS', label: 'Read & Write' },
            { value: 'READ_ONLY', label: 'Read Only' },
            { value: 'NO_ACCESS', label: 'No Access' }
        ];

        this.dataAccessOptions = dataAccessOptions;
        this.dataAccessFilter = ko.observable(null);

        this.trustOptions = trustOptions;
        this.trustFilter = ko.observable(null);

        this.stateOptions = stateOptions;
        this.stateFilter = ko.observable(null);

        this.activityOptions = activityOptions;
        this.activityFilter = ko.observable(null);


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
            sortBy: this.sortedBy(),
            order: this.order(),
            page: page
        });
    }

    filterObjects(phrase) {
        redirectTo(undefined, undefined, {
            filter: phrase || undefined,
            sortBy: this.sortedBy(),
            order: this.order(),
            page: 0
        });
    }

    orderBy(colName) {
        redirectTo(undefined, undefined, {
            filter: this.filter(),
            sortBy: colName,
            order: this.sortedBy() === colName ? 0 - this.order() : 1,
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
