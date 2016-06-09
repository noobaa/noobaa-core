import template from './create-pool-wizard.html';
import chooseNameStepTemplate from './choose-name-step.html';
import assignNodesStepTemplate from './assign-nodes-step.html';
import ko from 'knockout';
import nameValidationRules from 'name-validation-rules';
import NodeRowViewModel from './node-row';
import { makeArray } from 'utils';
import { poolList, nodeList } from 'model';
import { loadNodeList, createPool } from 'actions';


class CreatePoolWizardViewModel {
    constructor({ onClose }) {
        this.chooseNameStepTemplate = chooseNameStepTemplate;
        this.assignNodesStepTemplate = assignNodesStepTemplate;
        this.onClose = onClose;

        let existingPoolNames = poolList.map(
            ({ name }) => name
        );

        this.poolName = ko.observable()
            .extend({
                validation: nameValidationRules('pool', existingPoolNames)
            });

        this.rows = makeArray(
            500,
            i => new NodeRowViewModel(() => nodeList()[i])
        );

        this.selectedNodes = ko.observableArray()
            .extend({
                minLength: {
                    params: 3,
                    message: 'Please select at least 3 nodes'
                }
            });

        this.chooseNameErrors = ko.validation.group([
            this.poolName
        ]);

        this.assignNodesErrors = ko.validation.group([
            this.selectedNodes
        ]);

        loadNodeList();
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

    createPool() {
        createPool(this.poolName(), this.selectedNodes());
    }
}

export default {
    viewModel: CreatePoolWizardViewModel,
    template: template
};
