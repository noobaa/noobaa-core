import { observable } from 'knockout';
import numeral from 'numeral';
import template from './buckets-overview.html';

class BucketsOverviewViewModel {
	constructor() {
		this.bucketCount = observable(12);
		this.fileCount = observable(40000);
	}

	get bucketCountText() {
		let formatted = numeral(this.bucketCount()).format('0,0');
		return `${formatted} Buckets`;
	}

	get fileCountText() {
		let formatted = numeral(this.fileCount()).format('0,0');
		return `${formatted} Files`;
	}
}

export default { 
	viewModel: BucketsOverviewViewModel,
	template: template
}
