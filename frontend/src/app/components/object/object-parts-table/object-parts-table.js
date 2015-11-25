import template from './object-parts-table.html';
import PartRowViewModel from './part-row';

class ObjectPartsTableViewModel {
	constructor({ parts }) {
		this.rows = parts
			.map(part => new PartRowViewModel(part, parts().length));
	}
}

export default {
	viewModel: ObjectPartsTableViewModel,
	template: template
}