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

		let tier = ko.pureComputed(
			() => !!bucketPolicy() ? bucketPolicy().tiers[0].tier : null
		);

		this.dataReady = ko.pureComputed(
			() => !!tier()
		);

		this.tierName = ko.pureComputed(
			() => tier().name
		);

		this.dataPlacement = ko.observableWithDefault(
			() => tier().dataPlacement
		);

		this.selectedPools = ko.observableWithDefault(
			() => tier().pools
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
			this.tierName(),
			this.dataPlacement(),
			this.selectedPools()
		);

		this.onClose();
	}

	cancel() {
		this.onClose();
	}
}

export default {
	viewModel: BucketPolicyModalViewModel,
	template: template
}