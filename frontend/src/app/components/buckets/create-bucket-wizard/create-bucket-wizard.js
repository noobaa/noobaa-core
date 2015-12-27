import template from './create-bucket-wizard.html';
import chooseNameStepTempalte from './choose-name-step.html'
import setPolicyStepTempalte from './set-policy-step.html'
import ko from 'knockout';
import bucketNameValidationRules from './bucket-name-validation-rules';
import { poolList } from 'model';
import { createBucket } from 'actions';
import { defaultPoolName } from 'config';
import { cloneArray } from 'utils';

class CreateBucketWizardViewModel {
	constructor({ onClose }) {
		this.onClose = onClose;
		this.chooseNameStepTemplate = chooseNameStepTempalte;
		this.setPolicyStepTemplate = setPolicyStepTempalte;

		this.bucketName = ko.observable()
			.extend({ validation: bucketNameValidationRules });

		this.dataPlacement = ko.observable('SPREAD');

		this.pools = poolList.map(
			pool => pool.name
		);

		this.selectedPools = ko.observableArray([ defaultPoolName ])
			.extend({ required: { message: 'Please select at least one pool for the policy' } });
	}

	validateStep(step) {
		switch (step) {
			case 1: 
				let isNameValid = this.bucketName.isValid();
				!isNameValid && this.bucketName.valueHasMutated();  
				return isNameValid;

			case 2: 
				let isPoolsValid = this.selectedPools.isValid();
				!isPoolsValid && this.selectedPools.valueHasMutated();
				return isPoolsValid;
		}
	}

	selectAllPools() {
		this.selectedPools(
			cloneArray(this.pools())
		);
	}

	clearAllPools() {
		this.selectedPools
			.removeAll();
	}

	createBucket() {
		createBucket(this.bucketName(), this.dataPlacement(), this.selectedPools());
	}
}

export default {
	viewModel: CreateBucketWizardViewModel,
	template: template
};