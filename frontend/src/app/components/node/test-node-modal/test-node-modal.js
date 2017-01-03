import template from './test-node-modal.html';
import TestRowViewModel from './test-row';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { nodeTestInfo } from 'model';
import { testNode, abortNodeTest } from 'actions';
import { deepFreeze } from 'utils/core-utils';
import moment from 'moment';

const testTypes = Object.freeze([
    {
        name: 'Full test',
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

const columns = deepFreeze([
    'test',
    'targetNode',
    'protocol',
    'ip',
    'port',
    'time',
    'speed',
    'progress'
]);

class TestNodeModalViewModel extends BaseViewModel {
    constructor({ sourceRpcAddress, onClose }) {
        super();

        this.onClose = onClose;
        this.columns = columns;

        this.testTypeOptions = testTypes.map(
            ({ name, tests }) => {
                return { label: name, value: tests };
            }
        );

        this.sourceRpcAddress = sourceRpcAddress;
        this.selectedTests = ko.observable(testTypes[0].tests);

        this.results = ko.pureComputed(
            () => nodeTestInfo() && nodeTestInfo().results
        );

        this.lastTestTime = ko.pureComputed(
            () => nodeTestInfo() &&
                `( Last test results from: ${
                    moment(nodeTestInfo().timestemp).format('HH:mm:ss')
            } )`
        );

        this.testing = ko.pureComputed(
            () => !!nodeTestInfo() && nodeTestInfo().state === 'IN_PROGRESS'
        );

        this.summary = ko.pureComputed(
            () => this.results() && this._summarizeResults(this.results())
        );

        this.bandwidthSummary = ko.pureComputed(
            () => this._getTestSummary(this.results(), 'bandwidth')
        );

        this.closeBtnText = ko.pureComputed(
            () => this.testing() ? 'Abort & Close' : 'Close'
        );
    }

    _summarizeResults(results) {
        return results.reduce(
            (summary, { state }) => {
                summary.inProcess += Number(state === 'RUNNING' || state === 'WAITING');
                summary.completed += Number(state === 'COMPLETED');
                summary.failed += Number(state === 'FAILED');
                summary.aborted += Number(state === 'ABORTED');
                return summary;
            }, {
                inProcess: 0,
                completed: 0,
                failed: 0,
                aborted: 0
            }
        );
    }

    createTestRow(test) {
        return new TestRowViewModel(test);
    }

    runTest() {
        testNode(ko.unwrap(this.sourceRpcAddress), this.selectedTests());
    }

    close() {
        if (this.testing()) {
            abortNodeTest();
        }
        this.onClose();
    }
}

export default {
    viewModel: TestNodeModalViewModel,
    template: template
};
