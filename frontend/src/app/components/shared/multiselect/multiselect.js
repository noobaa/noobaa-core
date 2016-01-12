import template from './multiselect.html';
import ko from 'knockout';

class MultiSelectViewModel {
	constructor({ options = [], selected = [] }) {
		this.options = options.map(
			option => {
				let value = ko.unwrap(option);
				return typeof value === 'object' ? value : { value: option,  label: option.toString() } 
			}
		);

		//this.options = options;
		this.selected = selected;
	}
}

export default {
	viewModel: MultiSelectViewModel,
	template: template
}