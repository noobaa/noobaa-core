/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import numeral from 'numeral';
import * as routes from 'routes';
import { realizeUri } from 'utils/browser-utils';
import {
    getInternalResourceStateIcon,
    getInternalResourceDisplayName
} from 'utils/resource-utils';


export default class ResourceRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.name = ko.observable();
        this.connectedBuckets = ko.observable();
        this.capacity = {
            total: ko.observable(0),
            used: ko.observable(0)
        };
    }

    onState(resource, bucketCount, connectedBuckets, system) {
        const { storage } = resource;
        const connectedBucketsText = `${
            numeral(connectedBuckets.length).format('0,0')
        } of ${
            numeral(bucketCount).format('0,0')
        } buckets`;

        const connectedBucketsValue = {
            text: connectedBucketsText,
            tooltip: connectedBuckets.length > 0 ? {
                template: 'linkList',
                text: connectedBuckets.map(bucket => ({
                    text: bucket,
                    href: realizeUri(routes.bucket, { system, bucket })
                }))
            } : null
        };

        this.state(getInternalResourceStateIcon(resource));
        this.name(getInternalResourceDisplayName(resource));
        this.connectedBuckets(connectedBucketsValue);
        this.capacity.total(storage.total);
        this.capacity.used(storage.used);
    }
}
