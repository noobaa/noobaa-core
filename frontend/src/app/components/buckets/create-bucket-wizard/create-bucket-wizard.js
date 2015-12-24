import template from './create-bucket-wizard.html';
import chooseNameStepTempalte from './choose-name-step.html'
import setPolicyStepTempalte from './set-policy-step.html'
import ko from 'knockout';
import { domFromHtml } from 'utils';
import bucketNameValidationRules from './bucket-name-validation-rules';
import { poolList } from 'model';
import { createBucket } from 'actions';
import { defaultPoolName } from 'config';

class CreateBucketWizardViewModel {
	constructor({ visible }) {
		this.visible = visible;
		this.chooseNameStepNodes = domFromHtml(chooseNameStepTempalte);
		this.setPolicyStepNodes = domFromHtml(setPolicyStepTempalte);

		this.bucketName = ko.observable()
			.extend({ validation: bucketNameValidationRules });

		this.dataPlacement = ko.observable('SPREAD');

		this.pools = poolList.map(
			pool => pool.name
		);

		this.selectedPools = ko.observableArray([ 
			defaultPoolName
		]);
	}

	validateStep(step) {
		switch (step) {
			case 1: 
				let isNameValid = this.bucketName.isValid();
				
				// Irritate the observable in order to force display the 
				// validation message.
				!isNameValid && this.bucketName.valueHasMutated();  
		
				return isNameValid;

			case 2: 
				return this.selectedPools().length > 0;
		}
	}

	selectAllPools() {
		this.selectedPools(
			new Array(...this.pools())
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