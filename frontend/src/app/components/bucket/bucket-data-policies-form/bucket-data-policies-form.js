/* Copyright (C) 2016 NooBaa */

import template from './bucket-data-policies-form.html';
import Observer from 'observer';
import { state$ } from 'state';
import ko from 'knockout';
import { getMany } from 'rx-extensions';

class BucketDataPoliciesFormViewModel extends Observer {
    bucketLoaded = ko.observable();

    constructor() {
        super();

        this.observe(
            state$.pipe(
                getMany(
                    'buckets',
                    ['location', 'params', 'bucket']
                )
            ),
            this.onState
        );
    }

    onState([buckets, bucketName]) {
        this.bucketLoaded(Boolean(buckets && buckets[bucketName]));
    }
}

export default {
    viewModel: BucketDataPoliciesFormViewModel,
    template: template
};
