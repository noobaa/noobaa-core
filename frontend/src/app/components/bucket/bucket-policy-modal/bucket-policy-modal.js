import template from './bucket-policy-modal.html';
import ko from 'knockout';
import { noop, cloneArray } from 'utils';
import { poolList, bucketPolicy } from 'model';
import { readSystemInfo, readBucketPolicy, updateTier } from 'actions';

class BucketPolicyModalViewModel {
	constructor({ policyName, onClose = noop }) {
		this.onClose = onClose;

		this.pools = poolList.map(
			pool => pool.name
		);

		this.dataPlacement = ko.observable();
		this.selectedPools = ko.observableArray();

		this.tier = ko.pureComputed(
			() => bucketPolicy() ? bucketPolicy().tiers[0].tier : null
		);

		this.initSubscription = this.tier.subscribe(
			tier => {
				this.dataPlacement(tier.data_placement);
				this.selectedPools(tier.pools)
			}
		);

		readBucketPolicy(ko.unwrap(policyName));
		readSystemInfo();
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

	save() {
		updateTier(
			this.tier().name,
			this.dataPlacement(),
			this.selectedPools()
		);

		this.onClose();
	}

	cancel() {
		this.onClose();
	}

	dispose() {
		console.log('here');
		this.initSubscription.dispose();
	}
}

export default {
	viewModel: BucketPolicyModalViewModel,
	template: template
}