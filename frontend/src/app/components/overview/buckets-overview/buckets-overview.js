import template from './buckets-overview.html';
import ko from 'knockout';
import numeral from 'numeral';

class BucketsOverviewViewModel {
    constructor({ bucketCount, objectCount }) {
        
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
}
