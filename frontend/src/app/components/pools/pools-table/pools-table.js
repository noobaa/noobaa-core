import template from './pools-table.html';
import ko from 'knockout';
import PoolRowViewModel from './pool-row';
import { stringifyQueryString, makeArray } from 'utils';

const maxRows = 100;

class PoolsTableViewModel {
	constructor({ pools }) {
		let deleteCandidate = ko.observable();			
		let rows = makeArray(
			maxRows, 
			i => new PoolRowViewModel(() => pools()[i], deleteCandidate)
		);

		this.sortedBy = pools.sortedBy;
		this.order = pools.order;
		this.visibleRows = ko.pureComputed(
			() => rows.filter(row => row.isVisible())
		);
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
	viewModel: PoolsTableViewModel,
	template: template
} 