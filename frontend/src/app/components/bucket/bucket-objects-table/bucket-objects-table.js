import template from './bucket-objects-table.html';
import ko from 'knockout';
import page from 'page';
import { paginationPageSize as pageSize } from 'config';
import { throttle, makeArray, stringifyQueryString } from 'utils';
import ObjectRowViewModel from './object-row';

class BucketObjectsTableViewModel {
	constructor({ objects }) {
		this.count = objects.count;
		this.filter = objects.filter;
		this.sortedBy = objects.sortedBy;
		this.order = objects.order;
		this.currPage = objects.page;

		this.filter = ko.pureComputed({
			read: () => objects.filter(),
			write: throttle(phrase => this.filterObjects(phrase), 750)
		});

		this.noResults = ko.pureComputed(
			() => this.count() === 0
		);

		this.pageStart = ko.pureComputed(
			() => this.currPage() * pageSize + 1
		);		

		this.pageEnd = ko.pureComputed(
			() => Math.min(this.pageStart() + pageSize - 1, this.count())
		);

		this.inFirstPage = ko.pureComputed(
			() => this.currPage() === 0
		);

		this.inLastPage = ko.pureComputed(
			() => (this.currPage() + 1) * pageSize >= this.count()
		);

		this.backwardIcon = ko.pureComputed(
			() => `/assets/icons.svg#backward${this.inFirstPage() ? '-disabled' : '' }`
		);

		this.forwardIcon = ko.pureComputed(
			() => `/assets/icons.svg#forward${this.inLastPage() ? '-disabled' : '' }`
		);		

		this.rows = makeArray(
			pageSize,
			i => new ObjectRowViewModel(() => objects()[i])
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

	pageForward() {
		this._query(
			this.filter(),
			this.sortedBy(),
			this.order(),
			this.currPage() + 1
		)
	}

	pageBackward() {
		this._query(
			this.filter(),
			this.sortedBy(),
			this.order(),
			this.currPage() - 1
		)
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
	viewModel: BucketObjectsTableViewModel,
	template: template,
}