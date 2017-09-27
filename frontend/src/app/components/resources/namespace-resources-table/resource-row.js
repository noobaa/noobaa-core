/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { stringifyAmount } from 'utils/string-utils';
import { deepFreeze } from 'utils/core-utils';
import { getNamespaceResourceStateIcon, getNamespaceResourceTypeIcon } from 'utils/resource-utils';

const undeletableReasonToTooltip = deepFreeze({
    IN_USE: 'Cannot delete a resource which is used by a gateway bucket'
});

export default class ResourceRowViewModel {
    constructor({ deleteGroup, onDelete }) {
        this.state = ko.observable();
        this.type = ko.observable();
        this.name = ko.observable();
        this.connectedBuckets = ko.observable();
        this.deleteButton = {
            subject: 'resource',
            id: ko.observable(),
            disabled: ko.observable(),
            tooltip: ko.observable(),
            group: deleteGroup,
            onDelete: onDelete
        };
    }

    onResource(resource, connectedBuckets) {
        const { name, undeletable } = resource;
        const conenctedBucketsInfo = {
            text: stringifyAmount('bucket', connectedBuckets.length),
            tooltip: connectedBuckets
        };
        const deleteTooltip = undeletableReasonToTooltip[undeletable] || 'Delete Resource';

        this.state(getNamespaceResourceStateIcon(resource));
        this.type(getNamespaceResourceTypeIcon(resource));
        this.name(name);
        this.connectedBuckets(conenctedBucketsInfo);
        this.deleteButton.id(name);
        this.deleteButton.disabled(Boolean(undeletable));
        this.deleteButton.tooltip(deleteTooltip);
    }
}
