import template from './buckets-table.html'
import BucketRowViewModel from './bucket-row';
import ko from 'knockout';
import { deleteBucket } from 'actions';

class BucketsTableViewModel {
	constructor({ buckets }) {
		this.rows = buckets.map(
			bucket => new BucketRowViewModel(bucket)
		);

		this.deleteCandidate = ko.observable();			
	}

	isDeleteCandidate(bucketName) {
		return bucketName === this.deleteCandidate();
	}

	confirmDelete() {
		deleteBucket(this.deleteCandidate());
	}

	cancelDelete() {
		this.deleteCandidate(null);
	}	
}

export default {
	viewModel: BucketsTableViewModel,
	template: template
}