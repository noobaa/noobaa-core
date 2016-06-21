import template from './buckets-table.html';
import BucketRowViewModel from './bucket-row';
import ko from 'knockout';
import { makeArray, cmpBools, cmpInts, cmpStrings } from 'utils';
import { redirectTo } from 'actions';
import { systemInfo, routeContext } from 'model';

const maxRows = 100;

const bucketCmpFuncs = Object.freeze({
    state: (b1, b2) => cmpBools(b1.state, b2.state),
    name: (b1, b2) => cmpStrings(b1.name, b2.name),
    filecount: (b1, b2) => cmpInts(b1.num_objects, b2.num_objects),
    totalsize: (b1, b2) => cmpInts(b1.storage.total, b2.storage.total),
    freesize: (b1, b2) => cmpInts(b1.storage.free, b2.storage.free),
    cloudsync: (b1, b2) => cmpStrings(b1.cloud_sync_status, b2.cloud_sync_status)
});

class BucketsTableViewModel {
    constructor() {
        let query = ko.pureComputed(
            () => routeContext().query
        );

        this.sortedBy = ko.pureComputed(
            () => query().sortBy || 'name'
        );

        this.order = ko.pureComputed(
            () => Number(query().order) || 1
        );

        let buckets = ko.pureComputed(
            () => (systemInfo()? systemInfo().buckets.slice(0) : []).sort(
                (b1, b2) => this.order() * bucketCmpFuncs[this.sortedBy()](b1, b2)
            )
        );

        let rows = makeArray(
            maxRows,
            i => new BucketRowViewModel(
                () => buckets()[i],
                () => buckets().length === 1
            )
        );

        this.visibleRows = ko.pureComputed(
            () => rows.filter(row => row.isVisible())
        );

        this.deleteGroup = ko.observable();
        this.isCreateBucketWizardVisible = ko.observable(false);
    }

    showCreateBucketWizard() {
        this.isCreateBucketWizardVisible(true);
    }

    hideCreateBucketWizard() {
        this.isCreateBucketWizardVisible(false);
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
