import template from './create-pool-wizard.html';
import chooseNameStepTemplate from './choose-name-step.html';
import assignNodesStepTemplate from './assign-nodes-step.html';
import Disposable from 'disposable';
import ko from 'knockout';
import nameValidationRules from 'name-validation-rules';
import NodeRowViewModel from './node-row';
import { makeArray, throttle } from 'utils';
import { inputThrottle } from 'config';
import { systemInfo, nodeList } from 'model';
import { loadNodeList, createPool } from 'actions';


class CreatePoolWizardViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.chooseNameStepTemplate = chooseNameStepTemplate;
        this.assignNodesStepTemplate = assignNodesStepTemplate;
        this.onClose = onClose;

        this.nodes = nodeList;

        let poolNames = ko.pureComputed(
            () => systemInfo() && systemInfo().pools.map(
                pool => pool.name
            )
        );

        let existingPoolNames = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : []).map(
                ({ name }) => name
            )
        );

        this.poolName = ko.observable()
            .extend({
                validation: nameValidationRules('pool', existingPoolNames)
            });

        this.rows = makeArray(
            500,
            i => new NodeRowViewModel(() => nodeList()[i])
        );

        let _nameOrIpFilter = ko.observable();
        this.nameOrIpFilter = ko.pureComputed({
            read: _nameOrIpFilter,
            write: throttle(val => _nameOrIpFilter(val) && this.loadNodes(), inputThrottle)
        });

        this.poolFilterOptions = ko.pureComputed(
            () => [].concat(
                { label: 'All pools', value: poolNames() },
                poolNames().map(
                    name => ({ label: name, value: [name] })
                )
            )
        );

        let _poolFilter = ko.observableWithDefault(poolNames);
        this.poolFilter = ko.pureComputed({
            read: _poolFilter,
            write: val => _poolFilter(val) && this.loadNodes()
        });

        let _onlineFilter = ko.observable(true);
        this.onlineFilter = ko.pureComputed({
            read: _onlineFilter,
            write: val => _onlineFilter(val) && this.loadNodes()
        });

        this.selectedNodes = ko.observableArray()
            .extend({
                minLength: {
                    params: 3,
                    message: 'Please select at least 3 nodes'
                }
            });

        this.nodeCount = ko.pureComputed(
            () => systemInfo() && systemInfo().nodes.count
        );

        this.chooseNameErrors = ko.validation.group([
            this.poolName
        ]);

        this.assignNodesErrors = ko.validation.group([
            this.selectedNodes
        ]);

        let isFiltered = ko.pureComputed(
            () => this.nameOrIpFilter() ||
                this.onlineFilter() ||
                this.poolFilter() !== poolNames()
        );

        this.emptyMessage = ko.pureComputed(
            () => {
                if (!systemInfo() || !nodeList() || nodeList().length > 0) {
                    return;

                } else if (systemInfo().nodes.count === 0) {
                    return 'The system contain no nodes';

                } else if (isFiltered()) {
                    return 'The current filter does not match any node';
                }
            }
        );

        this.loadNodes();
    }

    validateStep(step) {
        switch (step) {
            case 1:
                if (this.chooseNameErrors().length > 0) {
                    this.chooseNameErrors.showAllMessages();
                    return false;
                }
                break;

            case 2:
                if (this.assignNodesErrors().length > 0) {
                    this.assignNodesErrors.showAllMessages();
                    return false;
                }
                break;
        }

        return true;
    }

    loadNodes() {
        loadNodeList(
            this.nameOrIpFilter(),
            this.poolFilter(),
            this.onlineFilter() || undefined
        );
    }

    createPool() {
        createPool(this.poolName(), this.selectedNodes());
    }
}

export default {
    viewModel: CreatePoolWizardViewModel,
    template: template
};
