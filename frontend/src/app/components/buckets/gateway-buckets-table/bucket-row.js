/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { getGatewayBucketStateIcon } from 'utils/bucket-utils';
import { stringifyAmount } from  'utils/string-utils';
import { realizeUri } from 'utils/browser-utils';

export default class BucketRowViewModel {
    constructor({ deleteGroup, onDelete }) {
        this.state = ko.observable();
        this.name = ko.observable();
        this.objectCount = ko.observable();
        this.readPolicy = ko.observable();
        this.writePolicy = ko.observable();
        this.deleteButton = {
            subject: 'resource',
            id: ko.observable(),
            tooltip: 'Delete Bucket',
            group: deleteGroup,
            onDelete: onDelete
        };
    }

    onBucket(bucket, baseUri) {
        const name = {
            text: bucket.name,
            href: realizeUri(baseUri, { bucket: bucket.name })
        };

        const { readFrom, writeTo } = bucket.placement;
        const readPolicy = {
            text: stringifyAmount('namespace resource', readFrom.length, 'No'),
            tooltip: readFrom
        };

        this.name(name);
        this.state(getGatewayBucketStateIcon(bucket));
        this.readPolicy(readPolicy);
        this.writePolicy(writeTo);
        this.deleteButton.id(bucket.name);
    }
}
