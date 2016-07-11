import template from './bucket-placement-policy-modal.html';
import PoolRow from './pool-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { noop } from 'utils';
import { systemInfo } from 'model';
import { updateBucketPlacementPolicy } from 'actions';

class BacketPlacementPolicyModalViewModel extends Disposable {
    constructor({ policy, onClose = noop }) {
        super();

        this.onClose = onClose;

        this.tierName = ko.pureComputed(
            () => ko.unwrap(policy) && ko.unwrap(policy).tiers[0].tier
        );

        let tier = ko.pureComputed(
            () => {
                if (!systemInfo() || !this.tierName()) {
                    return;
                }

                return systemInfo().tiers.find(
                    ({ name }) =>  this.tierName() === name
                );
            }
        );

        this.placementType = ko.observableWithDefault(
            () => tier() && tier().data_placement
        );

        this.pools = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : [])
                .filter(
                   ({ nodes }) => nodes
                )
                .map(
                    pool => new PoolRow(pool, tier())
                )
        );
    }

    selectAllPools() {
        this.pools().forEach(
            ({ selected }) => selected(true)
        );
    }

    clearAllPools() {
        this.pools().forEach(
            ({ selected }) => selected(false)
        );
    }

    save() {
        let selectedPools = this.pools()
            .filter(
                ({ selected }) => selected()
            )
            .map(
                ({ name }) => name
            );

        updateBucketPlacementPolicy(
            this.tierName(),
            this.placementType(),
            selectedPools
        );

        this.onClose();
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: BacketPlacementPolicyModalViewModel,
    template: template
};
