import template from './buckets-overview.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import numeral from 'numeral';

class BucketsOverviewViewModel extends BaseViewModel {
    constructor({ bucketCount, objectCount }) {

        super();

        this.bucketCountText = ko.pureComputed(() => {
            let count = ko.unwrap(bucketCount);
            return `${numeral(count).format('0,0')} Buckets`;
        });

        this.objectCountText = ko.pureComputed(() => {
            let count = ko.unwrap(objectCount);
            return `${numeral(count).format('0,0')} Files`;
        });
    }
}

export default {
    viewModel: BucketsOverviewViewModel,
    template: template
};
