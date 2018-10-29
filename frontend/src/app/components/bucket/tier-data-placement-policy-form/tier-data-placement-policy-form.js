/* Copyright (C) 2016 NooBaa */

import template from './tier-data-placement-policy-form.html';
import ConnectableViewModel from 'components/connectable';
import { getPlacementTypeDisplayName, getPlacementStateIcon } from 'utils/bucket-utils';
import { deepFreeze, groupBy, flatMap } from 'utils/core-utils';
import { aggregateStorage } from 'utils/storage-utils';
import { formatSize, sumSize } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import {
    getResourceId,
    unassignedRegionText,
    getHostPoolStateIcon,
    getHostPoolHostsSummary,
    getHostPoolNodesSummary,
    getCloudResourceStateIcon,
    getCloudResourceTypeIcon
} from 'utils/resource-utils';
import { requestLocation, openEditTierDataPlacementModal } from 'action-creators';
import ko from 'knockout';
import numeral from 'numeral';
import * as routes from 'routes';

const columns = deepFreeze([
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
        type: 'link'
    },
    {
        name: 'region'
    },
    {
        name: 'healthyHosts',
        label: 'Healthy Nodes'
    },
    {
        name: 'healthyNodes',
        label: 'Healthy Drives'
    },
    {
        name: 'bucketUsage',
        label: 'Raw Usage by This Bucket',
        type: 'capacity'
    }
]);

const nodesPoolType = deepFreeze({
    name: 'nodes-pool',
    tooltip: 'Nodes Pool'
});

const emptyTierStateIcon = deepFreeze({
    name: 'problem',
    css: 'warning',
    tooltip: {
        align: 'start',
        text: 'Tier is empty'
    }
});

const editTierPlacementTooltip = 'Editing the tier\'s resources will be enabled after adding storage resources to the system';

function _systemHasResources(hostPools, cloudResource) {
    return Object.keys(hostPools).length > 0 ||
        Object.keys(cloudResource).length > 0;
}


function _mapHostPoolToRow(pool, bucketUsage = 0, system) {
    const resourceName = {
        text: pool.name,
        tooltip: { text: pool.name, breakWords: true },
        href: realizeUri(routes.pool, { system, pool: pool.name })
    };

    return {
        resourceName,
        state: getHostPoolStateIcon(pool),
        type: nodesPoolType,
        region: pool.region || unassignedRegionText,
        healthyHosts: getHostPoolHostsSummary(pool),
        healthyNodes: getHostPoolNodesSummary(pool),
        bucketUsage: {
            total: pool.storage.total,
            used: bucketUsage
        }
    };
}

function _mapCloudResrouceToRow(resource, bucketUsage = 0, system) {
    const resourceName = {
        text: resource.name,
        tooltip: { text: resource.name, breakWords: true },
        href: realizeUri(routes.cloudResource, { system, resource: resource.name })
    };

    return {
        resourceName,
        state: getCloudResourceStateIcon(resource),
        type: getCloudResourceTypeIcon(resource),
        region: resource.region || unassignedRegionText,
        healthyHosts: '---',
        healthyNodes: '---',
        bucketUsage: {
            total: resource.storage.total,
            used: bucketUsage
        }
    };
}

class ResourceRowViewModel {
    resourceName = ko.observable();
    state = ko.observable();
    type = ko.observable();
    region = ko.observable();
    healthyHosts = ko.observable();
    healthyNodes = ko.observable();
    bucketUsage = {
        total: ko.observable(),
        used: ko.observable()
    };
}

class TierDataPlacementPolicyFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    bucketName = '';
    tierName = '';
    tierDisplayName = ko.observable();
    toggleUri = '';
    stateIcon = ko.observable();
    placementType = ko.observable();
    hostPoolCount = ko.observable();
    cloudResourceCount = ko.observable();
    capacity = ko.observable();
    isExpanded = ko.observable();
    columns = columns;
    isEditTierPlacementDisabled = ko.observable();
    editTierPlacementTooltip = ko.observable();
    emptyMessage = ko.observable();
    rows = ko.observableArray()
        .ofType(ResourceRowViewModel);

    selectState(state, params) {
        const { bucketName, tierIndex } = params;
        return [
            state.buckets && state.buckets[bucketName],
            tierIndex,
            state.hostPools,
            state.cloudResources,
            state.location.params
        ];
    }

    mapStateToProps(
        bucket,
        tierIndex,
        hostPools,
        cloudResources,
        locationParams
    ) {
        const tierDisplayName = `Tier ${tierIndex + 1}`;
        if (!bucket || !hostPools || !cloudResources) {
            ko.assignToProps(this, {
                dataReady: false,
                tierDisplayName,
                isEditTierPlacementDisabled: false,
                isExpanded: false
            });

        } else {
            const hasResources = _systemHasResources(hostPools, cloudResources);
            const usageDistribution = bucket.usageDistribution.resources;
            const tier = bucket.placement2.tiers[tierIndex];
            const { system, tab = 'data-placement', section } = locationParams;
            const isExpanded = section === tier.name;
            const toggleUri = realizeUri(routes.bucket, {
                system,
                bucket: bucket.name,
                tab,
                section: isExpanded ? undefined : tier.name
            });

            if (tier.policyType === 'INTERNAL_STORAGE') {
                ko.assignToProps(this, {
                    dataReady: true,
                    bucketName: bucket.name,
                    tierName: tier.name,
                    tierDisplayName,
                    toggleUri,
                    stateIcon: emptyTierStateIcon,
                    placementType: 'Spread',
                    hostPoolCount: numeral(0).format(','),
                    cloudResourceCount: numeral(0).format(','),
                    capacity: `${formatSize(0)} of ${formatSize(0)}`,
                    isExpanded,
                    isEditTierPlacementDisabled: !hasResources,
                    editTierPlacementTooltip: !hasResources && editTierPlacementTooltip,
                    emptyMessage: 'No connected resources - using internal disks as default',
                    rows: []
                });

            } else {
                const resources = flatMap(tier.mirrorSets, ms => ms.resources);
                const { HOSTS: hostPoolNames = [], CLOUD: cloudResourceNames = [] } = groupBy(
                    resources,
                    res => res.type,
                    res => res.name
                );
                const storage = aggregateStorage(
                    ...resources.map(res => {
                        const coll = res.type === 'HOSTS' ? hostPools : cloudResources;
                        return coll[res.name].storage;
                    })
                );
                const freeStorage = sumSize(
                    storage.free || 0,
                    storage.unavailableFree || 0
                );

                ko.assignToProps(this, {
                    dataReady: true,
                    bucketName: bucket.name,
                    tierName: tier.name,
                    tierDisplayName,
                    toggleUri,
                    stateIcon: getPlacementStateIcon(tier.mode),
                    placementType: getPlacementTypeDisplayName(tier.policyType),
                    hostPoolCount: numeral(hostPoolNames.length).format(','),
                    cloudResourceCount: numeral(cloudResourceNames.length).format(','),
                    capacity: `${formatSize(freeStorage)} of ${formatSize(storage.total || 0)}`,
                    isExpanded,
                    isEditTierPlacementDisabled: !hasResources,
                    editTierPlacementTooltip: !hasResources && editTierPlacementTooltip,
                    emptyMessage: 'No resources participate in policy',
                    rows: [
                        ...hostPoolNames.map(name => _mapHostPoolToRow(
                            hostPools[name],
                            usageDistribution[getResourceId('HOSTS', name)],
                            system
                        )),
                        ...cloudResourceNames.map(name => _mapCloudResrouceToRow(
                            cloudResources[name],
                            usageDistribution[getResourceId('CLOUD', name)],
                            system
                        ))
                    ]
                });
            }
        }
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }

    onEditTierPlacement(_, evt) {
        const { bucketName, tierName } = this;
        const tierDisplayName = this.tierDisplayName();
        this.dispatch(openEditTierDataPlacementModal(bucketName, tierName, tierDisplayName));
        evt.stopPropagation();
    }
}

export default {
    viewModel: TierDataPlacementPolicyFormViewModel,
    template: template
};
