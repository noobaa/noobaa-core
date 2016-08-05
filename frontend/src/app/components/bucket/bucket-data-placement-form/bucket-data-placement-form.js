import template from './bucket-data-placement-form.html';
import placementSectionTemplate from './placement-policy-section.html';
import backupPolicySectionTemplate from './backup-policy-section.html';
import Disposable from 'disposable';
import PlacementRowViewModel from './placement-row';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils';

const placementTableColumns = deepFreeze([
    {
        name: 'state',
        cellTemplate: 'icon'
    },
    {
        name: 'poolName',
        cellTemplate: 'link'
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

const placementTypeMapping = deepFreeze({
    SPREAD: 'Spread',
    MIRROR: 'Mirror'
});

const resourceIcons = deepFreeze([
    {
        pattern: 's3.amazonaws.com',
        icon: 'amazon-resource'
    },
    {
        pattern: 'storage.googleapis.com',
        icon: 'google-resource'
    },
    {
        pattern: '',
        icon: 'cloud-resource'
    }
]);

class BucketDataPlacementFormViewModel extends Disposable {
    constructor({ bucket }) {
        super();

        this.placementSectionTemplate = placementSectionTemplate;
        this.backupPolicySectionTemplate = backupPolicySectionTemplate;
        this.placementTableColumns = placementTableColumns;

        this.policy = ko.pureComputed(
            () => ko.unwrap(bucket) && ko.unwrap(bucket).tiering
        );

        let tier = ko.pureComputed(
            () => {
                if (!systemInfo() || !this.policy()) {
                    return;
                }

                let tierName = this.policy().tiers[0].tier;
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
            () => systemInfo() && tier() && tier().node_pools.map(
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
                name => {
                    if (!systemInfo()) {
                        return;
                    }

                    let { cloud_info } = systemInfo().pools.find(
                        pool => pool.name === name
                    );

                    let endpoint = cloud_info.endpoint.toLowerCase();
                    let { icon } = resourceIcons.find(
                        ({ pattern }) => endpoint.indexOf(pattern) > 0
                    );

                    return { name: name, icon: icon };
                }
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
