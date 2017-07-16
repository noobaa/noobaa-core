/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-placement-form.html';
import BaseViewModel from 'components/base-view-model';
import PlacementRowViewModel from './placement-row';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { action$ } from 'state';
import {
    openEditBucketQuotaModal,
    openBucketPlacementPolicyModal
} from 'action-creators';

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
    constructor({ bucketName }) {
        super();

        const bucket = ko.pureComputed(
            () => systemInfo() && systemInfo().buckets.find(
                bucket => bucket.name === ko.unwrap(bucketName)
            )
        );

        this.bucketName = bucketName;

        this.placementTableColumns = placementTableColumns;

        let tier = ko.pureComputed(
            () => {
                if (!systemInfo() || !bucket()) {
                    return;
                }

                let tierName = bucket().tiering.tiers[0].tier;
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
        action$.onNext(openEditBucketQuotaModal(
            ko.unwrap(this.bucketName)
        ));
    }

    onEditDataPlacement() {
        action$.onNext(openBucketPlacementPolicyModal(
            ko.unwrap(this.bucketName)
        ));
    }

}

export default {
    viewModel: BucketDataPlacementFormViewModel,
    template: template
};
