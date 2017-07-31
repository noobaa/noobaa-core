/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { getBucketStateIcon, getBucketCapacityBarValues } from 'utils/ui-utils';
import { stringifyAmount } from 'utils/string-utils';
import { deepFreeze } from 'utils/core-utils';

const placementPolicyTypeMapping = deepFreeze({
    SPREAD: 'Spread',
    MIRROR: 'Mirrored'
});

export default class BucketRowViewModel extends BaseViewModel {
    constructor() {
        super();
        this.status = ko.observable();
        this.selected = ko.observable();
        this.bucketName = ko.observable();
        this.bucketPolicy = ko.observable();
        this.capacity = ko.observable();
        this.selectedBuckets = ko.observableArray();

        this.selected = ko.pureComputed({
            read: () => this.selectedBuckets().includes(this.bucketName()),
            write: selected => selected ?
                this.selectedBuckets.push(this.bucketName()) :
                this.selectedBuckets.remove(this.bucketName())
        });
    }

    onUpdate({ bucket, selectedBuckets }) {
        this.selectedBuckets = selectedBuckets;
        this.status = (bucket ? getBucketStateIcon(bucket) : '');
        this.bucketName(bucket ? bucket.name : '');
        this.bucketPolicy({
            text: `${stringifyAmount('Resource', bucket.backingResources.resources.length)} ${placementPolicyTypeMapping[bucket.backingResources.type]}`,
            tooltip: bucket.backingResources.resources.map(item => item.name)
        });

        this.capacity = (getBucketCapacityBarValues(bucket || {}));

        return this;
    }
}
