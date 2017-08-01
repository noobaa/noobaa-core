/* Copyright (C) 2016 NooBaa */

import template from './bucket-selection-table.html';
import BucketRowViewModel from './bucket-row';
import Observer from 'observer';
import { deepFreeze } from 'utils/core-utils';
import ko from 'knockout';

const columns = deepFreeze([
    {
        name: 'selected',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'status',
        type: 'icon'
    },
    'bucketName',
    'bucketPolicy',
    {
        name: 'capacity',
        label: 'Bucket Storage Usage',
        type: 'capacity'
    }
]);

class BucketSelectionTableViewModel extends Observer {
    constructor({
                    caption = 'Select Buckets',
                    buckets = [],
                    selectedBuckets = ko.observableArray(),
                    bucketCount = ko.pureComputed(() => ko.unwrap(buckets).length),
                    emptyMessage = ''
                }) {
        super();

        const rows = buckets().map(bucket => (new BucketRowViewModel()).onUpdate({ bucket, selectedBuckets}));

        this.columns = columns;
        this.caption = caption;
        this.buckets = ko.observable([]);
        this.selectedBuckets = selectedBuckets;
        this.emptyMessage = emptyMessage;
        this.bucketNames = ko.pureComputed(
            () => (ko.unwrap(buckets) || []).map(
                bucket => bucket.name
            )
        );

        this.selectedMessage = ko.pureComputed(
            () => {
                let selectedCount = this.selectedBuckets().length;
                return `${selectedCount} buckets selected of all buckets (${bucketCount()})`;
            }
        );

        this.buckets().length = rows.length;
        for (let i = 0; i < rows.length; ++i) {
            this.buckets()[i] = rows[i];
        }
        this.buckets(this.buckets());
    }

    selectListedBuckets() {
        let buckets = this.bucketNames().filter(
            bucket => !this.selectedBuckets().includes(bucket)
        );

        this.selectedBuckets(
            this.selectedBuckets().concat(buckets)
        );
    }

    clearListedBuckets() {
        this.selectedBuckets.removeAll(
            this.bucketNames()
        );
    }

    clearAllBuckets() {
        this.selectedBuckets([]);
    }
}

export default {
    viewModel: BucketSelectionTableViewModel,
    template: template
};
