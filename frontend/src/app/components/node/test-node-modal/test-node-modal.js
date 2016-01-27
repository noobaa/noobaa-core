import template from './test-node-modal.html';
import TestRowViewModel from './test-row';
import ko from 'knockout';
import { nodeTestResults } from 'model';
import { testNode } from 'actions';
import { makeArray } from 'utils';
import moment from 'moment';

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
		this.hasResults = ko.pureComputed(
			() => !!nodeTestResults() && nodeTestResults().length > 0
		);

		this.lastTestTime = ko.pureComputed(
			() => nodeTestResults.timestemp() &&
				`( From: ${moment(nodeTestResults.timestemp()).format('HH:mm:ss')} )`
		);

		this.rows = makeArray(	
			100,
			i => new TestRowViewModel(() => nodeTestResults()[i])
		);
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