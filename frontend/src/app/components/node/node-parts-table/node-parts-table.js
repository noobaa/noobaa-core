import template from './node-parts-table.html';
import ko from 'knockout';
import page from 'page';
import { makeArray, stringifyQueryString } from 'utils';
import PartRowViewModel from './part-row';
import { paginationPageSize } from 'config';

class NodePartsViewModel {
	constructor({ parts }) {
		this.pageSize = paginationPageSize;
		this.count = parts.count;

		this.currPage = ko.pureComputed({
			read: parts.page,
			write: page => this.goTo(page)
		});

		this.rows = makeArray(
			this.pageSize,
			i => new PartRowViewModel(() => parts()[i])
		);
	}

	goTo(pageNum) {
		let query = stringifyQueryString({ page: pageNum });
		page.show(`${window.location.pathname}?${query}`);
	}
}

export default {
	viewModel: NodePartsViewModel,
	template: template
}