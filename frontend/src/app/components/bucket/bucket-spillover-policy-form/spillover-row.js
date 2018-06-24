/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import {
    getResourceStateIcon,
    getInternalResourceDisplayName,
    getResourceTypeIcon
} from 'utils/resource-utils';

export default class SpilloverRowViewModel {
    state = ko.observable();
    type = ko.observable();
    resourceName = ko.observable();
    bucketUsage = ko.observable();

    onResource(type, resource, bucketUsage) {
        const name = type === 'INTERNAL' ? getInternalResourceDisplayName(resource) : resource.name;

        this.resourceName(name);
        this.state(getResourceStateIcon(type, resource));
        this.type(getResourceTypeIcon(type, resource));
        this.bucketUsage({
            total: resource.storage.total,
            used: bucketUsage
        });
    }
}
