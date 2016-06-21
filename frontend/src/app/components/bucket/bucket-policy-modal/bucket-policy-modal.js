import template from './bucket-policy-modal.html';
import ko from 'knockout';
import { noop } from 'utils';
import { systemInfo, tierInfo } from 'model';
import { loadTier, updateTier } from 'actions';

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
            () => !!tierInfo() && tierInfo().pools
        );

        this.pools = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : []).map(
                ({ name }) => name
            )
        );

        loadTier(this.tierName());
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
