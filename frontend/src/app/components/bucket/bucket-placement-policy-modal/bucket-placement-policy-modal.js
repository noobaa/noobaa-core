import template from './bucket-placement-policy-modal.html';
import editScreenTemplate from './edit-screen.html';
import warningScreenTemplate from './warn-screen.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { noop, deepFreeze } from 'utils/all';
import { systemInfo } from 'model';
import { updateBucketPlacementPolicy } from 'actions';

const screenMapping = deepFreeze({
    0: { title: 'Bucket Data Placement Policy', sizeCss: 'modal-large' },
    1: { title: 'Empty Data Placement Policy', sizeCss: 'modal-xsmall', severity: 'warn' }
});

class BacketPlacementPolicyModalViewModel extends Disposable {
    constructor({ bucketName, onClose = noop }) {
        super();

        this.onClose = onClose;
        this.screen = ko.observable(0);
        this.editScreenTemplate = editScreenTemplate;
        this.warningScreenTemplate = warningScreenTemplate;

        this.modalInfo = ko.pureComputed(
            () => screenMapping[this.screen()]
        );

        this.tierName = ko.pureComputed(
            () => {
                if(!systemInfo()) {
                    return '';
                }

                let bucket = systemInfo().buckets.find(
                    bucket => bucket.name === ko.unwrap(bucketName)
                );

                return bucket.tiering.tiers[0].tier;
            }
        );

        this.tier = ko.pureComputed(
            () => {
                if (!this.tierName()) {
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
            () => (systemInfo() ? systemInfo().pools : [])
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

        this.isWarningVisible = ko.pureComputed(
            () => {
                if (this.placementType() === 'MIRROR') {
                    return false;
                }

                let { nodes, cloud } = this.selectedPools().reduce(
                    (counts, poolName) => {
                        this.pools().filter( pool => pool.name === poolName)[0].nodes ?
                            counts.nodes++ :
                            counts.cloud++ ;
                        return counts;
                    },
                    { nodes: 0, cloud: 0 }
                );
                return nodes > 0 && cloud > 0;
            }
        );
    }

    backToEdit() {
        this.screen(0);
    }

    beforeSave() {
        if (this.selectedPools().length === 0) {
            this.screen(1);
        } else {
            this.save();
        }
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
