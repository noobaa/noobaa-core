import template from './multiselect.html';
import ko from 'knockout';

class MultiSelectViewModel {
	constructor({ options, selected }) {
		this.options = options.map(
			name => ({ 
				name: name,
				selected: ko.pureComputed({
					read: () => selected.indexOf(name) > -1,
					write: value => value ? selected.push(name) : selected.remove(name)
				})
			})	
		);
	}
}

export default {
	viewModel: MultiSelectViewModel,
	template: template
}