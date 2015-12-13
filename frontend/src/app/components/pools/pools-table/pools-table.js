import template from './pools-table.html';
import PoolRowViewModel from './pool-row';
import { stringifyQueryString } from 'utils';

class PoolsTableViewModel {
	constructor({ pools }) {
		this.sortedBy = pools.sortedBy;
		this.order = pools.order;
		this.rows = pools.map(
			bucket => new PoolRowViewModel(bucket)
		);
	}

	orderHrefFor(colName) {
		return '?' + stringifyQueryString({
			sortBy: colName,
			order: this.sortedBy() === colName ? 0 - this.order() : 1
		});
	}	

	orderCssFor(colName) {
		if (this.sortedBy() === colName) {
			return this.order() === 1 ? 'des' : 'asc' ;
		} 
	}	
}

export default {
	viewModel: PoolsTableViewModel,
	template: template
} 