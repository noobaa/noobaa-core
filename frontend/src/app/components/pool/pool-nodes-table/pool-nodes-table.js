import template from './pool-nodes-table.html';
import ko from 'knockout';
import page from 'page';
import { paginationPageSize } from 'config';
import { makeArray} from 'utils';
import NodeRowViewModel from './node-row';
import { throttle, stringifyQueryString } from 'utils';

class PoolNodesTableViewModel {
	constructor({ nodes }) {
		this.pageSize = paginationPageSize;
		this.count = nodes.count;
		this.sortedBy = nodes.sortedBy;
		this.order = nodes.order;

		this.currPage = ko.pureComputed({
			read: nodes.page,
			write:  page => this.goTo(page)
		});

		this.filter = ko.pureComputed({
			read: nodes.filter,
			write: throttle(phrase => this.filterObjects(phrase), 750)
		});

		this.rows = makeArray(
			this.pageSize,
			i => new NodeRowViewModel(() => nodes()[i])
		);
	}

	goTo(pageNum) {
		this._query(
			this.filter(),
			this.sortedBy(),
			this.order(),
			pageNum
		)
	}

	filterObjects(phrase) {
		this._query(
			phrase || undefined, 
			this.sortedBy(), 
			this.order(),
			0
		); 
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

	_query(filter, sortBy, order, pageNum) {
		let query = stringifyQueryString({ filter, sortBy, order, page: pageNum });
		page.show(`${window.location.pathname}?${query}`);		
	}	
}

export default {
	viewModel: PoolNodesTableViewModel,
	template: template,
}