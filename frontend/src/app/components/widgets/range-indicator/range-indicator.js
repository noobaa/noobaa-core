import template from './range-indicator.html';
import ko from 'knockout';

import { formatSize } from 'utils';

class RangeBarViewModel {
	constructor({ values }) {
		this.values = values;
		this.total = ko.computed(() => values.reduce( (sum, { value }) => sum + ko.unwrap(value), 0 ));
	}

	percentageFor(value) {
		return `${ko.unwrap(value) / this.total() * 100}%`;
	}
}

export default {
	viewModel: RangeBarViewModel,
	template: template
}
