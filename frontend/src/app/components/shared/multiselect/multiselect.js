import template from './multiselect.html';

class MultiSelectViewModel {
	constructor({ options = [], selected = [] }) {
		this.options = options;
		this.selected = selected;
	}
}

export default {
	viewModel: MultiSelectViewModel,
	template: template
}