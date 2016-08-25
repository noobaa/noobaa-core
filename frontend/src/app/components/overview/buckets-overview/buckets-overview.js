import template from './buckets-overview.html';
import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';

class BucketsOverviewViewModel extends Disposable {
    constructor({ bucketCount, objectCount }) {

        super();

        this.bucketCountText = ko.pureComputed(() => {
            let count = ko.unwrap(bucketCount);
            return `${numeral(count).format('0,0')} Data Buckets`;
        });

        this.objectCountText = ko.pureComputed(() => {
            let count = ko.unwrap(objectCount);
            return `${numeral(count).format('0,0')} File${count === 1 ? '' : 's'}`;
        });
    }
}

export default {
    viewModel: BucketsOverviewViewModel,
    template: template
};
