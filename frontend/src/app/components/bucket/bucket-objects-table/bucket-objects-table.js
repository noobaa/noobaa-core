import template from './bucket-objects-table.html';
import ObjectRowViewModel from './object-row';

class BucketObjectsTableViewModel {
	constructor({ objects }) {

		this.rows = objects
			.map(obj => new ObjectRowViewModel(obj.key, obj.info));
	}
}

export default {
	viewModel: BucketObjectsTableViewModel,
	template: template,
}