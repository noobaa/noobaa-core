/* Copyright (C) 2016 NooBaa */

import template from './ns-bucket-data-placement-form.html';
import Observer from 'observer';
import ExternalResourceRowViewModel from './external-resource-row';
import { deepFreeze, pick } from 'utils/core-utils';
import ko from 'knockout';
import { state$ } from 'state';

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
        name: 'resourceName'
    },
    {
        name: 'targetName',
        label: 'Target Bucket Name'
    },
    {
        name: 'objectCount',
        label: 'Files in Target Bucket'
    },
    {
        name: 'usage',
        label: 'dataSize'
    }
]);

class NSBucketDataPlacementFormViewModel extends Observer {
    constructor({ bucket }) {
        super();

        this.columns = columns;
        this.rows = ko.observableArray();

        this.observe(
            state$.getMany(['nsBuckets', ko.unwrap(bucket)], 'externalResources'),
            this.onBucket
        );
    }

    onBucket([bucket, externalResources ]) {
        if (!bucket) return;

        const resources = Object.values(
            pick(externalResources, bucket.readPolicy)
        );

        this.rows(resources.map((resource, i) => {
            const row = this.rows()[i] || new ExternalResourceRowViewModel();
            row.onResource(resource);
            return row;
        }));

    }
}

export default {
    viewModel: NSBucketDataPlacementFormViewModel,
    template: template
};
