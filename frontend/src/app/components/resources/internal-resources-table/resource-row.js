import ko from 'knockout';
import { getInternalResourceStateIcon } from 'utils/resource-utils';
import numeral from 'numeral';

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

    onResources(resource, bucketCount, connectedBuckets) {
        const { name, storage } = resource;
        const connectedBucketsText = `${
            numeral(connectedBuckets.length).format('0,0')
        } of ${
            numeral(bucketCount).format('0,0')
        } buckets`;

        this.state(getInternalResourceStateIcon(resource));
        this.name({ text: name, tooltip: name });
        this.connectedBuckets({
            text: connectedBucketsText,
            tooltip: connectedBuckets
        });
        this.capacity.total(storage.total);
        this.capacity.used(storage.used);
    }
}
