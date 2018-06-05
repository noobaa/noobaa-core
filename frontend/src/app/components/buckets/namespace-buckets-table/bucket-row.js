/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { getNamespaceBucketStateIcon } from 'utils/bucket-utils';
import { stringifyAmount } from  'utils/string-utils';
import { realizeUri } from 'utils/browser-utils';

export default class BucketRowViewModel {
    constructor({ onSelectForDelete, onDelete }) {
        this.state = ko.observable();
        this.name = ko.observable();
        this.objectCount = ko.observable();
        this.readPolicy = ko.observable();
        this.writePolicy = ko.observable();
        this.deleteButton = {
            text: 'Delete bucket',
            id: ko.observable(),
            active: ko.observable(),
            tooltip: 'Delete Bucket',
            onToggle: onSelectForDelete,
            onDelete: onDelete
        };
    }

    onBucket(bucket, baseUri, selectedForDelete) {
        const name = {
            text: bucket.name,
            href: realizeUri(baseUri, { bucket: bucket.name })
        };

        const { readFrom, writeTo } = bucket.placement;
        const readPolicy = {
            text: stringifyAmount('namespace resource', readFrom.length, 'No'),
            tooltip: {
                template: 'list',
                text: readFrom
            }
        };

        this.name(name);
        this.state(getNamespaceBucketStateIcon(bucket));
        this.readPolicy(readPolicy);
        this.writePolicy(writeTo);
        this.deleteButton.id(bucket.name);
        this.deleteButton.active(selectedForDelete === bucket.name);
    }
}
