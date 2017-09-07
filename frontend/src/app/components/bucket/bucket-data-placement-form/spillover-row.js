/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { getInternalResourceStateIcon } from 'utils/resource-utils';

export default class PlacementRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.type = { name: 'internal-storage' };
        this.resourceName = ko.observable();
        this.bucketUsage = ko.observable();
        this.css = ko.observable();
    }

    onResource(resource, bucketUsage, disabled) {
        this.css(disabled ? 'disabled' : '');
        this.resourceName(resource.name);
        this.state(getInternalResourceStateIcon(resource));
        this.bucketUsage({
            total: resource.storage.total,
            used: bucketUsage
        });
    }
}
