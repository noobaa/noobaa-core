/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { getNamespaceResourceStateIcon, getNamespaceResourceTypeIcon } from 'utils/resource-utils';

export default class ResourceRowViewModel {
    constructor() {
        this.state = ko.observable();
        this.type = ko.observable();
        this.name = ko.observable();
        this.target = ko.observable();
    }

    onResource(resource, isWriteTarget) {
        const nameAndRule = {
            name: resource.name,
            rule: isWriteTarget ? 'Read & Write' : 'Read'
        };

        this.state(getNamespaceResourceStateIcon(resource));
        this.type(getNamespaceResourceTypeIcon(resource));
        this.name(nameAndRule);
        this.target(resource.target);
    }
}
