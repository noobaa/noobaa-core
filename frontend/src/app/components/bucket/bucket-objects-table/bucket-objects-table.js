import template from './bucket-objects-table.html';
import ko from 'knockout';
import page from 'page';
import { paginationPageSize } from 'config';
import { throttle, makeArray, stringifyQueryString } from 'utils';
import ObjectRowViewModel from './object-row';

class BucketObjectsTableViewModel {
	constructor({ objects }) {
		this.pageSize = paginationPageSize;
		this.count = objects.count;
		this.sortedBy = objects.sortedBy;
		this.order = objects.order;
		
		this.currPage = ko.pureComputed({
			read: objects.page,
			write:  page => this.goTo(page)
		});

		this.filter = ko.pureComputed({
			read: objects.filter,
			write: throttle(phrase => this.filterObjects(phrase), 750)
		});

		this.rows = makeArray(
			this.pageSize,
			i => new ObjectRowViewModel(
				() => objects()[i]
			)
		);
	}

	gotTo(pageNum) {
		this._query(
			this.filter(),
			this.sortedBy(),
			this.order(),
			pageNum
		);
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
	viewModel: BucketObjectsTableViewModel,
	template: template,
}