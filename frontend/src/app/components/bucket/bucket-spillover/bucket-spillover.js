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
    constructor({ bucketName }) {
        super();

        this.rows = ko.observable([]);
        this.columns = columns;
        this.emptyMessage = 'System does not contain any internal resources';
        this.tableDisabled = ko.observable();
        this.ChangeSpilloverButtonText = ko.observable();
        this.bucket = ko.observable();
        this.spilloverDisabled = ko.observable();
        this.observe(
            state$.getMany(
                ['internalResources', 'resources'],
                ['buckets', ko.unwrap(bucketName)]
            ),
            this.onState
        );
    }

    onState([internalResources, bucket]) {
        if(!bucket) return;
        const internalResourcesList = Object.values(internalResources);
        const spilloverDisabled = bucket.backingResources.spillover.length ?
            bucket.backingResources.spillover[0].disabled :
            true;
        const { used = 0 } = aggregateStorage(
            ...bucket.backingResources.spillover.map(
                spillover => ({
                    used: spillover.used,
                })
            )
        );

        this.spilloverDisabled(spilloverDisabled);
        this.rows(internalResourcesList.map((item, i) => {
            const row = this.rows()[i] || new SpilloverResourceRowViewModel();
            row.onUpdate({
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
            });
            return row;
        }));

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
