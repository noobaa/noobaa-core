/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-placement-form.html';
import BaseViewModel from 'components/base-view-model';
import PlacementRowViewModel from './placement-row';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { openEditBucketQuotaModal, openBucketPlacementPolicyModal } from 'dispatchers';

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
        type: 'custom-link'
    },
    {
        name: 'onlineNodeCount',
        label: 'online nodes in pool'
    },
    {
        name: 'capacity',
        label: 'Resource Capacity',
        type: 'capacity'
    }
]);

const placementTypeMapping = deepFreeze({
    SPREAD: 'Spread',
    MIRROR: 'Mirror'
});

class BucketDataPlacementFormViewModel extends BaseViewModel {
    constructor({ bucket }) {
        super();

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
                pool => pool.resource_type === 'HOSTS'
            ).length
        );

        this.cloudResourceCount = ko.pureComputed(
            () => this.nodePools() && this.nodePools().filter(
                pool => pool.resource_type === 'CLOUD'
            ).length
        );
    }

    createPlacementRow(pool) {
        return new PlacementRowViewModel(pool);
    }

    onEditBucketQuota() {
        openEditBucketQuotaModal(this.bucketName());
    }

    onEditDataPlacement() {
        openBucketPlacementPolicyModal(this.bucketName());
    }

}

export default {
    viewModel: BucketDataPlacementFormViewModel,
    template: template
};
