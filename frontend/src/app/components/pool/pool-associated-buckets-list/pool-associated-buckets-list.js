/* Copyright (C) 2016 NooBaa */

import template from './pool-associated-buckets-list.html';
import Observer from 'observer';
import { state$ } from 'state';
import * as routes from 'routes';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

// TODO: Replace with data from the state$ when available.
import { routeContext } from 'model';

class PoolAssociatedBucketsListViewModel extends Observer {
    constructor({ poolName }) {
        super();

        this.buckets = ko.observable();
        this.bucketCount = ko.observable();

        this.observe(
            state$.get('nodePools', 'pools', ko.unwrap(poolName), 'associatedBuckets'),
            this.onBuckets
        );
    }

    onBuckets(buckets) {
        const system = routeContext().params.system;

        this.buckets(
            buckets.map(bucket => ({
                name: bucket,
                href: realizeUri(routes.bucket, { system, bucket })
            }))
        );
        this.bucketCount(buckets.length);
    }
}

export default {
    viewModel: PoolAssociatedBucketsListViewModel,
    template: template
};
