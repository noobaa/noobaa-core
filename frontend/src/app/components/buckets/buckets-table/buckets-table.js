import template from './buckets-table.html';
import BucketRowViewModel from './bucket-row';
import ko from 'knockout';
import { makeArray } from 'utils';
import { redirectTo } from 'actions';

const maxRows = 100;

class BucketsTableViewModel {
    constructor({ buckets }) {
        let rows = makeArray(
            maxRows,
            i => new BucketRowViewModel(
                () => buckets()[i],
                () => buckets().length === 1
            )
        );

        this.sortedBy = buckets.sortedBy;
        this.order = buckets.order;
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
    viewModel: BucketsTableViewModel,
    template: template
};
