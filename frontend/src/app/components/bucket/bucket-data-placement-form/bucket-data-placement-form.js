import template from './bucket-data-placement-form.html';
import nodePoolsSectionTemplate from './node-pools-section.html';
import cloudResourcesSectionTemplate from './cloud-resources-section.html';
import ko from 'knockout';
import { tierInfo, systemInfo } from 'model';
import { loadTier } from 'actions';
import { formatSize, deepFreeze } from 'utils';

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

class BucketDataPlacementFormViewModel {
    constructor({ bucket }) {
        this.nodePoolsSectionTemplate = nodePoolsSectionTemplate;
        this.cloudResourcesSectionTemplate = cloudResourcesSectionTemplate;

        this.policy = ko.pureComputed(
            () => bucket() && bucket().tiering
        );

        let tierName = ko.pureComputed(
            () => this.policy() && this.policy().tiers[0].tier
        );

        this.tierSub = tierName.subscribe(
            name => loadTier(name)
        );

        this.placementType = ko.pureComputed(
            () => tierInfo() && placementTypeMapping[
                tierInfo().data_placement
            ]
        );

        this.nodePools = ko.pureComputed(
            () => tierInfo() && tierInfo().node_pools.map(
                name => {
                    if (!systemInfo()) {
                        return;
                    }

                    let { nodes, storage } = systemInfo().pools.find(
                        pool => pool.name === name
                    );

                    return {
                        name: name,
                        onlineNodeCount: nodes.count,
                        freeSpace: formatSize(storage.free)
                    };
                }
            )
        );

        this.nodePoolCount = ko.pureComputed(
            () => this.nodePools() && this.nodePools().length
        );

        this.cloudResources = ko.pureComputed(
            () => tierInfo() && tierInfo().cloud_pools.map(
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

        this.isPolicyModalVisible = ko.observable(false);

        tierName() && loadTier(tierName());
    }

    showPolicyModal() {
        this.isPolicyModalVisible(true);
    }

    hidePolicyModal() {
        this.isPolicyModalVisible(false);
    }

    dispose() {
        this.tierSub.dispose();
    }
}

export default {
    viewModel: BucketDataPlacementFormViewModel,
    template: template
};
