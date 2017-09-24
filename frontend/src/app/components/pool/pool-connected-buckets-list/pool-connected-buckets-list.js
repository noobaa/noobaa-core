/* Copyright (C) 2016 NooBaa */

import template from './pool-connected-buckets-list.html';
import Observer from 'observer';
import { state$ } from 'state';
import * as routes from 'routes';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class PoolConnectedBucketsListViewModel extends Observer {
    constructor({ poolName }) {
        super();

        this.bucketsLoaded = ko.observable(false);
        this.buckets = ko.observableArray();
        this.bucketCount = ko.observable();

        this.observe(
            state$.getMany(
                ['hostPools', ko.unwrap(poolName), 'connectedBuckets'],
                ['location', 'params', 'system']
            ),
            this.onBuckets
        );
    }

    onBuckets([ buckets, system ]) {
        if (!buckets) {
            this.bucketCount('');
            return;
        }

        this.buckets(
            buckets.map(bucket => ({
                name: bucket,
                href: realizeUri(routes.bucket, { system, bucket })
            }))
        );
        this.bucketCount(buckets.length.toString());
        this.bucketsLoaded(true);
    }
}

export default {
    viewModel: PoolConnectedBucketsListViewModel,
    template: template
};
