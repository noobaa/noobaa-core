/* Copyright (C) 2016 NooBaa */

import template from './ns-buckets-table.html';
import Observer from 'observer';
import NSBucketRowViewModel from './ns-bucket-row';
import ko from 'knockout';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { state$ } from 'state';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: bucket => bucket && 1
    },
    {
        name: 'name',
        label: 'bucket name',
        type: 'link',
        sortable: true,
        compareKey: bucket => bucket && 1
    },
    {
        name: 'objectCount',
        label: 'files',
        sortable: true,
        compareKey: bucket => bucket && 1
    },
    {
        name: 'readPolicy',
        sortable: true,
        compareKey: bucket => bucket && 1
    },
    {
        name: 'writePolicy',
        sortable: true,
        compareKey: bucket => bucket && 1
    },
    {
        name: 'usage',
        label: 'Data Size',
        sortable: true,
        compareKey: bucket => bucket && 1
    }
]);

class NSBucketsTableViewModel extends Observer {
    constructor() {
        super();

        this.columns = columns;
        this.sorting = ko.observable();
        this.rows = ko.observableArray();

        this.observe(
            state$.getMany('nsBuckets', ['location']),
            this.onBuckets
        );
    }

    onBuckets([ buckets, location ]) {
        if (location.params.tab !== 'namespace-buckets') return;

        const { sortBy = 'name', order = 1 } = location.query;
        this.sorting({ sortBy, order });

        const { compareKey } = columns.find(col => col.name === sortBy);
        const compareOp = createCompareFunc(compareKey, order);
        const orderedBuckets = Object.values(buckets).sort(compareOp);

        this.rows(orderedBuckets.map((res, i) => {
            const row = this.rows()[i] || new NSBucketRowViewModel();
            row.onBucket(res);
            return row;
        }));
    }
}

export default {
    viewModel: NSBucketsTableViewModel,
    template: template
};
