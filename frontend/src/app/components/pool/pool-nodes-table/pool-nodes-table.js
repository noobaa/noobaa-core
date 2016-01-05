import template from './pool-nodes-table.html';
import ko from 'knockout';
import page from 'page';
import { paginationPageSize as pageSize } from 'config';
import { makeArray} from 'utils';
import NodeRowViewModel from './node-row';
import { stringifyQueryString } from 'utils';

class PoolNodesTableViewModel {
	constructor({ nodes }) {
		this.rows = makeArray(
			pageSize,
			i => new NodeRowViewModel(() => nodes()[i])
		);

		this.sortedBy = nodes.sortedBy;
		this.order = nodes.order;
		this.filter = ko.observable('');
	}

	orderBy(colName) {
		this._query(
			this.filter(), 
			colName, 
			this.sortedBy() === colName ? 0 - this.order() : 1,
			0
		);
	}

	orderClassFor(colName) {
		if (this.sortedBy() === colName) {
			return this.order() === 1 ? 'des' : 'asc';
		} 
	}	

	_query(filter, sortBy, order, currPage) {
		let query = stringifyQueryString({ filter, sortBy, order, page: currPage });
		page.show(`${window.location.pathname}?${query}`);		
	}	
}

export default {
	viewModel: PoolNodesTableViewModel,
	template: template,
}