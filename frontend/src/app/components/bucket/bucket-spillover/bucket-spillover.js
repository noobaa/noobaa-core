/* Copyright (C) 2016 NooBaa */

import template from './bucket-spillover.html';
import SpilloverResourceRowViewModel from './spillover-resource-row';
import Observer from 'observer';
import { deepFreeze } from 'utils/core-utils';
import { updateBucketSpillover } from 'action-creators';
import { getPoolStateIcon, getPoolCapacityBarValues, getResourceTypeIcon } from 'utils/ui-utils';
import { aggregateStorage } from 'utils/storage-utils';
import ko from 'knockout';
import { state$, action$ } from 'state';

const columns = deepFreeze([
    {
        name: 'status',
        type: 'icon'
    },
    {
        name: 'type',
        type: 'icon'
    },
    {
        name: 'name',
        label: 'resource name'
    },
    {
        name: 'usage',
        label: 'used for spillover',
        type: 'capacity'
    }
]);

class BucketSpilloverViewModel extends Observer {
    constructor() {
        super();

        this.rows = ko.observable([]);
        this.columns = columns;
        this.emptyMessage = 'System does not contain any internal resources';
        this.tableDisabled = ko.observable();
        this.ChangeSpilloverButtonText = ko.observable();
        this.bucket = ko.observable();
        this.spilloverDisabled = ko.observable();
        this.observe(state$.getMany(['internalResources', 'resources'], 'buckets', ['location', 'params', 'bucket']), this.onState);
    }

    onState([internalResources, buckets, bucketName]) {
        const internalResourcesList = Object.values(internalResources);
        const bucket = buckets[bucketName];
        if(!bucket) return;

        const spilloverDisabled =
            bucket.backingResources.spillover.length ? bucket.backingResources.spillover[0].disabled : true;
        const { used = 0 } = aggregateStorage(
            ...bucket.backingResources.spillover.map(
                spillover => ({
                    used: spillover.used,
                })
            )
        );

        this.spilloverDisabled(spilloverDisabled);
        const rows = internalResourcesList.map(
            item => (new SpilloverResourceRowViewModel()).onUpdate({
                status: getPoolStateIcon(item),
                type: getResourceTypeIcon(item.resource_type),
                name: item.name,
                usage: getPoolCapacityBarValues({
                    resource_type: item.resource_type,
                    storage: {
                        total: item.storage.total,
                        used: used
                    }
                })
            })
        );

        for (let i = 0; i < rows.length; ++i) {
            this.rows()[i] = rows[i];
        }

        this.rows().length = rows.length;
        this.rows(this.rows());
        this.bucket(bucket);
        this.tableDisabled(spilloverDisabled);
        this.ChangeSpilloverButtonText(spilloverDisabled ? 'Enable Spillover' : 'Disable Spillover');
    }

    onChangeSpilloverState() {
        action$.onNext(updateBucketSpillover(this.bucket().name, this.spilloverDisabled()));
    }
}

export default {
    viewModel: BucketSpilloverViewModel,
    template: template
};
