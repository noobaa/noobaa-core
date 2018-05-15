/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import {
    getResourceStateIcon,
    getInternalResourceDisplayName,
    getCloudResourceTypeIcon
} from 'utils/resource-utils';

function _getResourceTypeIcon(type, resource) {
    if (type === 'HOSTS') {
        return {
            name: 'nodes-pool',
            tooltip: 'Nodes Pool Resource'
        };
    }

    if (type === 'CLOUD') {
        return getCloudResourceTypeIcon(resource);
    }

    if (type === 'INTERNAL') {
        return {
            name: 'internal-storage',
            tooltip: 'Internal Storage Resource'
        };
    }
}

export default class SpilloverRowViewModel {
    state = ko.observable();
    type = ko.observable();
    resourceName = ko.observable();
    bucketUsage = ko.observable();

    onResource(type, resource, bucketUsage) {
        const name = type === 'INTERNAL' ? getInternalResourceDisplayName(resource) : resource.name;

        this.resourceName(name);
        this.state(getResourceStateIcon(type, resource));
        this.type(_getResourceTypeIcon(type, resource));
        this.bucketUsage({
            total: resource.storage.total,
            used: bucketUsage
        });
    }
}
