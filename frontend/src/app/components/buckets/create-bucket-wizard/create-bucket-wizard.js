import template from './create-bucket-wizard.html';
import chooseNameStepTempalte from './choose-name-step.html'
import setPolicyStepTempalte from './set-policy-step.html'
import ko from 'knockout';
import bucketNameValidationRules from './bucket-name-validation-rules';
import { poolList } from 'model';
import { loadPoolList, createBucket } from 'actions';
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

		this.chooseNameErrors = ko.validation.group({
			name: this.bucketName
		})

		this.setPolicyErrors = ko.validation.group({
			selectedPools: this.selectedPools
		})

		loadPoolList();
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
				if (this.setPolicyErrors().length > 0) {
					this.setPolicyErrors.showAllMessages();
					return false;
				}
				break;
		}

		return true;
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