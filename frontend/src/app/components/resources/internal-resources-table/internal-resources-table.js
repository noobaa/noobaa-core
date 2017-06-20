/* Copyright (C) 2016 NooBaa */

import template from './internal-resources-table.html';
import InternalResourceRowViewModel from './internal-resource-row';
import Observer from 'observer';
import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { getPoolStateIcon, getPoolCapacityBarValues } from 'utils/ui-utils';
import ko from 'knockout';
import { state$ } from 'state';

const columns = deepFreeze([
    {
        name: 'status',
        type: 'icon'
    },
    {
        name: 'name',
        label: 'resource name'
    },
    {
        name: 'buckets',
        label: 'buckets using resource'
    },
    {
        name: 'usage',
        label: 'used for spillover',
        type: 'capacity'
    }
]);

class InternalResourcesTableViewModel extends Observer {
    constructor() {
        super();

        this.rows = ko.observable([]);
        this.columns = columns;
        this.buckets = ko.observable();
        this.emptyMessage = 'System does not contain any internal resources';

        this.observe(state$.getMany('internalResources', 'buckets'), this.onState);
    }

    onState([internalResources, buckets]) {
        const resourcesList = Object.values(internalResources.resources);
        const bucketsList = Object.values(buckets);
        const bucketsCount = bucketsList.length;
        const spilloverEnabledBucketsCount = bucketsList.filter(bucket => bucket.spilloverEnabled).length;
        const bucketsText = `${spilloverEnabledBucketsCount} of ${stringifyAmount('bucket', bucketsCount)}`;

        const rows = resourcesList.map(
            item => (new InternalResourceRowViewModel()).onUpdate({
                status: getPoolStateIcon(item),
                name: item.name,
                buckets: bucketsText,
                usage: getPoolCapacityBarValues(item || {})
            })
        );

        for (let i = 0; i < rows.length; ++i) {
            this.rows()[i] = rows[i];
        }
        this.rows().length = rows.length;
        this.rows(this.rows());

        this.buckets(bucketsList);
    }

    onEditSpilloverTargets() {
        // TODO:Add edit spillover targets modals to internal storage tab (resource page)
    }
}

export default {
    viewModel: InternalResourcesTableViewModel,
    template: template
};
