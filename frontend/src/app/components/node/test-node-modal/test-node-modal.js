import template from './test-node-modal.html';
import TestRowViewModel from './test-row';
import ko from 'knockout';
import { nodeTestResults } from 'model';
import { testNode } from 'actions';
import { makeArray } from 'utils';
import moment from 'moment';

const testTypes = Object.freeze([
    { 
        name: 'Full', 
        tests: ['connectivity', 'bandwidth'] 
    },
    { 
        name: 'Connectivity', 
        tests: ['connectivity'] 
    },
    { 
        name: 'Bandwidth', 
        tests: ['bandwidth'] 
    }
]);

class TestNodeModalViewModel {
    constructor({ sourceRpcAddress, onClose }) {
        this.onClose = onClose;

        this.testTypeOptions = testTypes.map(
            ({ name, tests }) => { 
                return { label: name, value: tests }
            }
        );

        this.sourceRpcAddress = sourceRpcAddress;

        this.selectedTests = ko.observable(testTypes[0].tests);

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
        testNode(ko.unwrap(this.sourceRpcAddress), this.selectedTests())
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: TestNodeModalViewModel,
    template: template
}