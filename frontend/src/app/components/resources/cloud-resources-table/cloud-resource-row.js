/* Copyright (C) 2018 NooBaa */

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { formatSize } from 'utils/size-utils';
import { getCloudResourceStateIcon, getCloudResourceTypeIcon } from 'utils/resource-utils';

const undeletableReasons = deepFreeze({
    IN_USE: 'Cannot delete a resource in use'
});

export default class CloudResourceRowViewModel {
    state = ko.observable();
    type = ko.observable();
    name = ko.observable();
    buckets = ko.observable();
    usage = ko.observable();
    cloudBucket = ko.observable();
    deleteButton = {
        id: ko.observable(),
        subject: 'resources',
        group: null,
        tooltip: ko.observable(),
        disabled: ko.observable(),
        onDelete: null
    };

    constructor({ deleteGroup, onDelete }) {
        this.deleteButton.group = deleteGroup;
        this.deleteButton.onDelete = onDelete;
    }

    onState(resource) {
        const { name, usedBy, target, undeletable } = resource;
        const buckets = {
            text: stringifyAmount('bucket', usedBy.length),
            tooltip: usedBy
        };
        const deleteTooltip = undeletableReasons[undeletable] || '';

        this.state(getCloudResourceStateIcon(resource));
        this.type(getCloudResourceTypeIcon(resource));
        this.name(name);
        this.buckets(buckets);
        this.usage(formatSize(resource.storage.used));
        this.cloudBucket(target);
        this.deleteButton.id(name);
        this.deleteButton.disabled(Boolean(undeletable));
        this.deleteButton.tooltip(deleteTooltip);
    }
}
