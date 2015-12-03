import template from './buckets-table.html'
import BucketRowViewModel from './bucket-row';
import ko from 'knockout';
import { deleteBucket } from 'actions';

		

class BucketsTableViewModel {
	constructor({ buckets }) {
		this.orderedBy = buckets.orderedBy;
		this.reversed = buckets.reversed;

		this.rows = ko.pureComputed(() => 
			buckets().map(bucket => new BucketRowViewModel(bucket))
		);
		
		this.deleteCandidate = ko.observable();			
	}

	hrefFor(colName) {
		let reverse = this.orderedBy() === colName && !this.reversed();
		return `?order-by=${colName}${reverse ? '&reverse' : ''}`;
	}

	cssFor(colName) {
		return this.orderedBy() === colName ?
			(this.reversed() ? 'asc' : 'des') :
			'';
	}

	deleteIconUri(bucketName) {
		let isOpened = bucketName === this.deleteCandidate();
		return `/assets/icons.svg#trash-${isOpened ? 'opened' : 'closed'}`;
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