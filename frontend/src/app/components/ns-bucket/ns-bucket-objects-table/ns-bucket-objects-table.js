/* Copyright (C) 2016 NooBaa */

import template from './ns-bucket-objects-table.html';
import ObjectRowViewModel from './object-row';
import Observer from 'observer';
import ko from 'knockout';
import { state$ } from 'state';
import { deepFreeze } from 'utils/core-utils';

const columns = deepFreeze([
    {
        name: 'name',
        label: 'File Name'
    },
    {
        name: 'creationTime'
    },
    {
        name: 'size'
    }
]);

class NSBucketObjectsTableViewModel extends Observer {
    constructor({ bucket }) {
        super();

        this.columns = columns;
        this.bucketName = ko.unwrap(bucket);
        this.objectCount = ko.observable();
        this.rows = ko.observableArray();

        this.observe(
            state$.get('nsBuckets', this.bucketName, 'objectCount'),
            this.objectCount
        );
    }

    onObjects({ objects }) {
        this.rows(objects.map(
            (obj, i) => {
                const row = this.rows()[i] || new ObjectRowViewModel();
                row.onObject(obj);
                return row;
            }
        ));
    }
}

export default {
    viewModel: NSBucketObjectsTableViewModel,
    template: template
};
