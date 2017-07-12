/* Copyright (C) 2016 NooBaa */

import template from './bucket-namespace-form.html';
import BaseViewModel from 'components/base-view-model';
import ResourceRowViewModel from './resource-row';
import { deepFreeze } from 'utils/core-utils';
import { systemInfo } from 'model';
import ko from 'knockout';
// import numeral from 'numeral';
// import moment from 'moment';

const columns = deepFreeze([
    {
        name: 'service',
        type: 'icon'
    },
    {
        name: 'target',
        label: 'Target Bucket'
    },
    {
        name: 'endpoint'
    },
    {
        name: 'identity'
    }
]);

class BucketNamespaceFormViewModel extends BaseViewModel {
    constructor({ bucketName }) {
        super();

        const bucket = ko.pureComputed(
            () => systemInfo() && systemInfo().buckets.find(
                bucket => bucket.name === ko.unwrap(bucketName)
            )
        );

        this.resources = ko.pureComputed(
            () => (bucket() && bucket().namespace)?
                bucket().namespace.list :
                []
        );

        this.columns = columns;
    }

    newResourceRow(resource) {
        return new ResourceRowViewModel(resource);
    }
}

export default {
    viewModel: BucketNamespaceFormViewModel,
    template: template
};
