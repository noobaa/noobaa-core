/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import {
    getInternalResourceStateIcon,
    getInternalResourceDisplayName
} from 'utils/resource-utils';

const spilloverResourceType = deepFreeze({
    name: 'internal-storage',
    tooltip: 'Internal Storage Resource'
});

export default class SpilloverRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.type = spilloverResourceType;
        this.resourceName = ko.observable();
        this.bucketUsage = ko.observable();
        this.css = ko.observable();
    }

    onResource(resource, bucketUsage, disabled) {
        this.css(disabled ? 'disabled' : '');
        this.resourceName(getInternalResourceDisplayName(resource));
        this.state(getInternalResourceStateIcon(resource));
        this.bucketUsage({
            total: resource.storage.total,
            used: bucketUsage
        });
    }
}
