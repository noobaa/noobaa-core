/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-placement-form.html';
import Observer from 'observer';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { action$, state$ } from 'state';
import {
    openEditBucketQuotaModal,
    openBucketPlacementPolicyModal
} from 'action-creators';

const placementTypeMapping = deepFreeze({
    SPREAD: 'Spread',
    MIRROR: 'Mirror'
});

class BucketDataPlacementFormViewModel extends Observer {
    constructor({ bucketName, baseRoute }) {
        super();
        this.bucketName = bucketName;
        this.baseRoute = baseRoute;

        this.placementType = ko.observable();
        this.nodePoolCount = ko.observable();
        this.cloudResourceCount = ko.observable();

        this.observe(state$.get('buckets', ko.unwrap(bucketName)), this.onBucket);
    }

    onBucket(bucket) {
        if(!bucket) return;

        const bucketResources = bucket.backingResources.resources;

        this.placementType(placementTypeMapping[bucket.backingResources.type]);
        this.nodePoolCount(
            bucketResources.filter(
                resource => resource.type === 'HOSTS'
            ).length
        );
        this.cloudResourceCount(
            bucketResources.filter(
                resource => resource.type === 'CLOUD'
            ).length
        );
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
