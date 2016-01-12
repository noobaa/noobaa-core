import template from './test-node-modal.html';
import ko from 'knockout';

const testTypes = Object.freeze([
	{ label: 'Full', value: 'FULL' },
	{ label: 'Connectivity', value: 'CONNECTIVITY' },
	{ label: 'Data Transfer', value: 'DATA_TRANSFER' },
	{ label: 'Load', value: 'LOAD'  }
]);

class TestNodeModalViewModel {
	constructor({ onClose }) {
		this.testTypes = testTypes;
		this.onClose = onClose;

		this.testType = ko.observable(testTypes[0].value);
	}

	runTest() {

	}

	close() {
		this.onClose();
	}
}

export default {
	viewModel: TestNodeModalViewModel,
	template: template
}