import template from './bucket-data-placement-form.html';
import placementSectionTemplate from './placement-policy-section.html';
import Disposable from 'disposable';
import PlacementRowViewModel from './placement-row';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/all';

const placementTableColumns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'type',
        type: 'icon'
    },
    {
        name: 'resourceName',
        type: 'customLink'
    },
    {
        name: 'onlineNodeCount',
        label: 'online nodes in pool'
    },
    {
        name: 'usedCapacity',
        label: 'used capacity by bucket',
        type: 'resourceCapacity'
    }
]);

const placementTypeMapping = deepFreeze({
    SPREAD: 'Spread',
    MIRROR: 'Mirror'
});

class BucketDataPlacementFormViewModel extends Disposable {
    constructor({ bucket }) {
        super();

        this.placementSectionTemplate = placementSectionTemplate;
        this.placementTableColumns = placementTableColumns;

        this.bucketName = ko.pureComputed(
            () => ko.unwrap(bucket) && ko.unwrap(bucket).name
        );

        let tier = ko.pureComputed(
            () => {
                if (!systemInfo() || !ko.unwrap(bucket)) {
                    return;
                }

                let tierName = ko.unwrap(bucket).tiering.tiers[0].tier;
                return systemInfo().tiers.find(
                    ({ name }) =>  tierName === name
                );
            }
        );

        this.placementType = ko.pureComputed(
            () => tier() && placementTypeMapping[
                tier().data_placement
            ]
        );

        this.nodePools = ko.pureComputed(
            () => tier() && tier().attached_pools.map(
                name => systemInfo().pools.find(
                    pool => pool.name === name
                )
            )
        );

        this.nodePoolCount = ko.pureComputed(
            () => this.nodePools() && this.nodePools().filter(
                pool => Boolean(pool.nodes)
            ).length
        );

        this.cloudResourceCount = ko.pureComputed(
            () => this.nodePools() && this.nodePools().filter(
                pool => Boolean(pool.cloud_info)
            ).length
        );

        this.editingDisabled = ko.pureComputed(
            () => Boolean(bucket() && bucket().demo_bucket)
        );

        this.editingDisabledTooltip = ko.pureComputed(
            () => this.editingDisabled() &&
                'Editing policies is not supported for demo buckets'
        );

        this.isPlacementPolicyModalVisible = ko.observable(false);
    }

    createPlacementRow(pool) {
        return new PlacementRowViewModel(pool);
    }

    showPlacementPolicyModal() {
        this.isPlacementPolicyModalVisible(true);
    }

    hidePlacementPolicyModal() {
        this.isPlacementPolicyModalVisible(false);
    }
}

export default {
    viewModel: BucketDataPlacementFormViewModel,
    template: template
};
