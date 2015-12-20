import template from './bucket-policy-form.html';
import ko from 'knockout';
import { noop, cloneArray } from 'utils';
import { updateBucketPolicy } from 'actions';

class BucketPolicyFormViewModel {
	constructor({ policy, oncomplete = noop }) {
		this.oncomplete = oncomplete;
		
		this.bucketName = ko.pureComputed(
			() => 'My Bucket'
		);

		this.dataPlacement = ko.pureComputed(
			() => 'STRIPE'
		);

		this.pools = [
			'Sony building', 
			'TwinTower-Dubai', 
			'AmsterdamP-Leiden', 
			'NY-Pool',
			'Meriland', 
			'Campus', 
			'Chicago', 
			'Chicago-02', 
			'Another Chicago',
			'San Francisco', 
			'Beijing_centeral', 
			'Seol-Station',
			'Memphis', 
			'Osaka-Servers',
			'Osaka-Desktops',
			'Beijing_centeral', 
			'Seol-Station',
			'Memphis',
			'Osaka-Servers2',
			'Osaka-Desktops2', 
			'Beijing_centeral2', 
			'Seol-Station2', 
			'Memphis2', 
			'Osaka-Servers3',
			'Osaka-Desktops3'
		];

		this.selectedPools = ko.observableArray();
	}

	selectAllPools() {
		this.selectedPools(
			cloneArray(ko.unwrap(this.pools))
		);
	}

	clearAllPools() {
		this.selectedPools
			.removeAll();
	}

	save() {
		updateBucketPolicy({ 
			bucketName: this.bucketName(),
			dataPlacement: this.dataPlacement(),
			pools: this.selectedPools()
		});

		this.oncomplete();
	}

	cancel() {
		this.oncomplete();
	}
}

export default {
	viewModel: BucketPolicyFormViewModel,
	template: template
}