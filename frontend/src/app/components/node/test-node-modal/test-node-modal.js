import template from './test-node-modal.html';
import TestRowViewModel from './test-row';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { nodeTestInfo } from 'model';
import { testNode, abortNodeTest } from 'actions';
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

class TestNodeModalViewModel extends BaseViewModel {
    constructor({ sourceRpcAddress, onClose }) {
        super();

        this.onClose = onClose;

        this.testTypeOptions = testTypes.map(
            ({ name, tests }) => {
                return { label: name, value: tests };
            }
        );

        this.sourceRpcAddress = sourceRpcAddress;

        this.selectedTests = ko.observable(testTypes[0].tests);

        let results = ko.pureComputed(
            () => nodeTestInfo() && nodeTestInfo().results
        );

        this.hasResults = ko.pureComputed(
            () => !!results() && results().length > 0
        );

        this.lastTestTime = ko.pureComputed(
            () => nodeTestInfo() &&
                `( From: ${moment(nodeTestInfo().timestemp).format('HH:mm:ss')} )`
        );

        this.testing = ko.pureComputed(
            () => !!nodeTestInfo() && nodeTestInfo().state === 'IN_PROGRESS'
        );

        this.rows = makeArray(
            100,
            i => new TestRowViewModel(() => results()[i])
        );
    }

    runTest() {
        testNode(ko.unwrap(this.sourceRpcAddress), this.selectedTests());
    }

    abortTest() {
        abortNodeTest();
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: TestNodeModalViewModel,
    template: template
};
