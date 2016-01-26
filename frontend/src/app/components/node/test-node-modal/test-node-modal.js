import template from './test-node-modal.html';
import ko from 'knockout';
import { testNode } from 'actions';

const testTypes = Object.freeze([
	{ 
		label: 'Full', 
		testSet: ['connectivity', 'bandwidth'] 
	},
	{ 
		label: 'Connectivity', 
		testSet: ['connectivity'] 
	},
	{ 
		label: 'Bandwidth', 
		testSet: ['bandwidth'] 
	}
]);

class TestNodeModalViewModel {
	constructor({ sourceRpcAddress, onClose }) {
		this.testTypes = testTypes;
		this.onClose = onClose;
		this.sourceRpcAddress = sourceRpcAddress;
		this.testSet = ko.observable(testTypes[0].testSet);
	}

	runTest() {
		testNode(ko.unwrap(this.sourceRpcAddress), this.testSet())
	}

	close() {
		this.onClose();
	}
}

export default {
	viewModel: TestNodeModalViewModel,
	template: template
}