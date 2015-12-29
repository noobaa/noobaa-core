import template from './create-pool-wizard.html';
import chooseNameStepTemplate from './choose-name-step.html';
import assignNodesStepTemplate from './assign-nodes-step.html';
import ko from 'knockout'; 
import NodeRowViewModel from './node-row';
import { makeArray } from 'utils';
import { nodeList } from 'model';
import { createPool } from 'actions';


class CreatePoolWizardViewModel {
	constructor({ onClose }) {
		this.chooseNameStepTemplate = chooseNameStepTemplate;
		this.assignNodesStepTemplate = assignNodesStepTemplate;
		this.onClose = onClose;

		this.poolName = ko.observable()
			.extend({
				required: { 
					params: true,
					message: 'Name is required'
				},
				maxLength: {
					params: 63,
					message: 'Name cannot be longer then 63 chars'
				}
			});

		this.rows = makeArray(
			500, 
			i => new NodeRowViewModel(() => nodeList()[i])
		);

		this.selectedNodes = ko.observableArray()
			.extend({
				minLength: {
					params: 3,
					message: 'Plase select at least 3 nodes'
				}
			});
	}

	validateStep(step) {
		switch (step) {
			case 1: 
				let isNameValid = this.poolName.isValid();
				!isNameValid && this.poolName.valueHasMutated();  
				return isNameValid;

			case 2: 
				let isSelecedNodesValid = this.selectedNodes.isValid();
				!isSelecedNodesValid && this.selectedNodes.valueHasMutated();
				return isSelecedNodesValid;
		}
	}

	createPool() {
		createPool(this.poolName(), this.selectedNodes());
	}
}

export default {
	viewModel: CreatePoolWizardViewModel,
	template: template
}