import template from './pools-table.html';
import ko from 'knockout';
import PoolRowViewModel from './pool-row';
import { makeArray } from 'utils';
import { redirectTo } from 'actions';

const maxRows = 100;

class PoolsTableViewModel {
    constructor({ pools }) {
        let rows = makeArray(
            maxRows,
            i => new PoolRowViewModel(() => pools()[i])
        );

        this.sortedBy = pools.sortedBy;
        this.order = pools.order;
        this.visibleRows = ko.pureComputed(
            () => rows.filter(row => row.isVisible())
        );

        this.deleteGroup = ko.observable();
    }

    orderBy(colName) {
        redirectTo(undefined, undefined, {
            sortBy: colName,
            order: this.sortedBy() === colName ? 0 - this.order() : 1
        });
    }

    orderClassFor(colName) {
        if (this.sortedBy() === colName) {
            return this.order() === 1 ? 'des' : 'asc' ;
        }
    }
}

export default {
    viewModel: PoolsTableViewModel,
    template: template
};
