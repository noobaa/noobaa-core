/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import {
    unassignedRegionText,
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

function _getResourceName(type, resource, system) {
    const { name } = resource;

    switch (type) {
        case 'HOSTS': {
            return {
                text: name,
                href: realizeUri(routes.pool, { system, pool: name }),
                tooltip: { text: name, breakWords: true }
            };
        }

        case 'CLOUD': {
            return {
                text: name,
                href: realizeUri(routes.cloudResource, { system, resource: name }),
                tooltip: { text: name, breakWords: true }
            };
        }

        case 'INTERNAL': {
            const displayName = getInternalResourceDisplayName(resource);
            return {
                text: displayName,
                href: '',
                tooltip: { text: displayName, breakWords: true }
            };
        }
    }
}

export default class SpilloverRowViewModel {
    state = ko.observable();
    type = ko.observable();
    resourceName = ko.observable();
    region = ko.observable();
    bucketUsage = ko.observable();

    onResource(type, resource, bucketUsage, system) {
        this.resourceName(_getResourceName(type, resource, system));
        this.region(resource.region || unassignedRegionText);
        this.state(getResourceStateIcon(type, resource));
        this.type(_getResourceTypeIcon(type, resource));
        this.bucketUsage({
            total: resource.storage.total,
            used: bucketUsage
        });
    }
}
