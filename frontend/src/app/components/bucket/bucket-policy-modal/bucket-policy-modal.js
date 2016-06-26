import template from './bucket-policy-modal.html';
import ko from 'knockout';
import { noop } from 'utils';
import { poolList, tierInfo } from 'model';
import { loadPoolList, loadTier, updateTier } from 'actions';

class BucketPolicyModalViewModel {
    constructor({ policy, onClose = noop }) {
        this.onClose = onClose;

        this.tierName = ko.pureComputed(
            () => policy().tiers[0].tier
        );

        this.dataReady = ko.pureComputed(
            () => !!tierInfo()
        );

        this.dataPlacement = ko.observableWithDefault(
            () => !!tierInfo() && tierInfo().data_placement
        );

        this.selectedPools = ko.observableWithDefault(
            () => !!tierInfo() && tierInfo().node_pools
        );

        this.pools = poolList.map(
            pool => pool.name
        );

        loadTier(this.tierName());
        loadPoolList();
    }

    selectAllPools() {
        this.selectedPools(
            Array.from(this.pools())
        );
    }

    clearAllPools() {
        this.selectedPools([]);
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
};
