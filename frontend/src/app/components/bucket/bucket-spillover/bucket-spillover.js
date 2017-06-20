/* Copyright (C) 2016 NooBaa */

import template from './bucket-spillover.html';
import SpilloverResourceRowViewModel from './spillover-resource-row';
import Observer from 'observer';
import { deepFreeze } from 'utils/core-utils';
//import { stringifyAmount } from 'utils/string-utils';
import { getPoolStateIcon, getPoolCapacityBarValues, getResourceTypeIcon } from 'utils/ui-utils';
import ko from 'knockout';
import { state$ } from 'state';

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
        this.ChangeSpilloverStateText = ko.observable();

        this.observe(state$.getMany('internalResources', 'buckets'), this.onState);
    }

    onState([internalResources, buckets]) {
        const resourcesList = Object.values(internalResources.resources);
        const bucketsList = Object.values(buckets);
        //const bucketsCount = bucketsList.length;
        //const spilloverEnabledBucketsCount = bucketsList.filter(bucket => bucket.spilloverEnabled).length;

        this.ChangeSpilloverStateText(bucketsList[0].spillover_enabled ? 'Disable Spillover' : 'Enable Spillover');
        console.warn('resourcesList', resourcesList);
        const rows = resourcesList.map(
            item => (new SpilloverResourceRowViewModel()).onUpdate({
                status: getPoolStateIcon(item),
                type: getResourceTypeIcon(item),
                name: item.name,
                usage: getPoolCapacityBarValues(item || {})
            })
        );

        for (let i = 0; i < rows.length; ++i) {
            this.rows()[i] = rows[i];
        }
        this.rows().length = rows.length;
        this.rows(this.rows());

        //this.buckets(bucketsList);
    }

    onChangeSpilloverState() {
        // TODO:Add edit spillover targets modals to internal storage tab (resource page)
    }
}

export default {
    viewModel: BucketSpilloverViewModel,
    template: template
};
