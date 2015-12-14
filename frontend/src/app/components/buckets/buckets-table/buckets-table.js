import template from './buckets-table.html'
import BucketRowViewModel from './bucket-row';
import ko from 'knockout';
import { stringifyQueryString, makeArray } from 'utils';
import page from 'page';

const maxRows = 100;

class BucketsTableViewModel {
	constructor({ buckets }) {
		let deleteCandidate = ko.observable();			
		let rows = makeArray(
			maxRows, 
			i => new BucketRowViewModel(() => buckets()[i], deleteCandidate)
		);

		this.sortedBy = buckets.sortedBy;
		this.order = buckets.order;
		this.visibleRows = ko.pureComputed(
			() => rows.filter(row => row.isVisible())
		)
	}

	orderBy(colName) {
		let query = stringifyQueryString({
			sortBy: colName,
			order: this.sortedBy() === colName ? 0 - this.order() : 1
		});

		page.show(`${window.location.pathname}?${query}`);
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
}