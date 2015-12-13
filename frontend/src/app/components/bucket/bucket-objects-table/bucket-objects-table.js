import template from './bucket-objects-table.html';
import ObjectRowViewModel from './object-row';
import ko from 'knockout';

class BucketObjectsTableViewModel {
	constructor({ objects, sortedBy, reversed }) {
		//this.sortedBy = objects.sortedBy;
		//this.reversed = reversed;

		this.sortedBy = ko.observable('name');
		this.reversed = ko.observable(false);

		this.rows = objects.map(
			obj => new ObjectRowViewModel(obj.key, obj.info)
		);
	}

	hrefFor(colName) {
		let reverse = this.sortedBy() === colName && !this.reversed();
		return `?sort-by=${colName}${reverse ? '&reverse' : ''}`;
	}

	cssFor(colName) {
		let selected = this.sortedBy() === colName;
		return {
			asc: selected && !this.reversed(),
			des:selected && this.reversed()
		};
	}
}

export default {
	viewModel: BucketObjectsTableViewModel,
	template: template,
}