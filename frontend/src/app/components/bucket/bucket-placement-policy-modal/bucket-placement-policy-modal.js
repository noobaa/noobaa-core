import template from './bucket-placement-policy-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { noop, deepFreeze } from 'utils';
import { systemInfo } from 'model';
import { updateBucketPlacementPolicy } from 'actions';

const columns = deepFreeze([
    {
        name: 'select',
        cellTemplate: 'checkbox'
    },
    {
        name: 'state',
        cellTemplate: 'icon'
    },
    'name',
    'onlineCount',
    'freeSpace'
]);

class BacketPlacementPolicyModalViewModel extends Disposable {
    constructor({ policy, onClose = noop }) {
        super();

        this.onClose = onClose;
        this.columns = columns;

        this.tierName = ko.pureComputed(
            () => ko.unwrap(policy) && ko.unwrap(policy).tiers[0].tier
        );

        this.tier = ko.pureComputed(
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
            () => this.tier() && this.tier().data_placement
        );

        this.pools = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : []).filter(
               ({ nodes }) => nodes
            )
        );

        this.selectedPools = ko.observableArray(
            Array.from(this.tier().node_pools)
        ).extend({
            validation: {
                validator: selected => {
                    return this.placementType() !== 'MIRROR' || selected.length !== 1;
                },
                message: 'Mirror policy requires at least 2 participating pools'
            }
        });

        this.errors = ko.validation.group(this);
    }

    save() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            updateBucketPlacementPolicy(
                this.tierName(),
                this.placementType(),
                this.selectedPools()
            );

            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: BacketPlacementPolicyModalViewModel,
    template: template
};
