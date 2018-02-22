/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import {
    getResourceStateIcon,
    getInternalResourceDisplayName
} from 'utils/resource-utils';

const typeToMeta = deepFreeze({
    HOSTS: {
        name: 'nodes-pool',
        tooltip: 'Nodes Pool Resource'
    },
    CLOUD: {
        name: 'cloud-hollow',
        tooltip: 'Cloud Resource'
    },
    INTERNAL: {
        name: 'internal-storage',
        tooltip: 'Internal Storage Resource'
    }
});

export default class SpilloverRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.type = ko.observable();
        this.resourceName = ko.observable();
        this.bucketUsage = ko.observable();
    }

    onResource(resource, bucketUsage, type) {
        const name = type === 'INTERNAL' ? getInternalResourceDisplayName(resource) : resource.name;

        this.resourceName(name);
        this.state(getResourceStateIcon(resource, type));
        this.type(typeToMeta[type]);
        this.bucketUsage({
            total: resource.storage.total,
            used: bucketUsage
        });
    }
}
