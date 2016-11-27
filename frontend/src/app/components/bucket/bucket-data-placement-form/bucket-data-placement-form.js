import template from './bucket-data-placement-form.html';
import placementSectionTemplate from './placement-policy-section.html';
import backupPolicySectionTemplate from './backup-policy-section.html';
import Disposable from 'disposable';
import PlacementRowViewModel from './placement-row';
import BackupRowViewModel from './backup-row';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/all';

const placementTableColumns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'poolName',
        type: 'link'
    },
    {
        name: 'onlineNodeCount',
        label: 'online nodes in pool'
    },
    {
        name: 'freeSpace',
        label: 'free space in pool'
    }
]);

const backupTableColumns = deepFreeze([
    {
        name: 'resourceType',
        label: 'type',
        type: 'icon'
    },
    'resourceName',
    {
        name: 'usage',
        label: 'Used by noobaa'
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
        this.backupPolicySectionTemplate = backupPolicySectionTemplate;
        this.placementTableColumns = placementTableColumns;
        this.backupTableColumns = backupTableColumns;

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
            () => tier() && tier().node_pools.map(
                name => systemInfo().pools.find(
                    pool => pool.name === name
                )
            )
        );

        this.nodePoolCount = ko.pureComputed(
            () => this.nodePools() && this.nodePools().length
        );

        this.cloudResources = ko.pureComputed(
            () => tier() && tier().cloud_pools.map(
                name => systemInfo().pools.find(
                    pool => pool.name === name
                )
            )
        );

        this.cloudResourceCount = ko.pureComputed(
            () => this.cloudResources() && this.cloudResources().length
        );

        this.editingDisabled = ko.pureComputed(
            () => Boolean(bucket() && bucket().demo_bucket)
        );

        this.editingDisabledTooltip = ko.pureComputed(
            () => this.editingDisabled() &&
                'Editing policies is not supported for demo buckets'
        );

        this.isPlacementPolicyModalVisible = ko.observable(false);
        this.isBackupPolicyModalVisible = ko.observable(false);
    }

    createPlacementRow(pool) {
        return new PlacementRowViewModel(pool);
    }

    createBackupRow(cloudResource) {
        return new BackupRowViewModel(cloudResource);
    }

    showPlacementPolicyModal() {
        this.isPlacementPolicyModalVisible(true);
    }

    hidePlacementPolicyModal() {
        this.isPlacementPolicyModalVisible(false);
    }

    showBackupPolicyModal() {
        this.isBackupPolicyModalVisible(true);
    }

    hideBackupPolicyModal() {
        this.isBackupPolicyModalVisible(false);
    }
}

export default {
    viewModel: BucketDataPlacementFormViewModel,
    template: template
};
