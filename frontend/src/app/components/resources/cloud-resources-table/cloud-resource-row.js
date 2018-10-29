/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { formatSize } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import {
    unassignedRegionText,
    getCloudResourceStateIcon,
    getCloudResourceTypeIcon
} from 'utils/resource-utils';
import * as routes from 'routes';

const undeletableReasons = deepFreeze({
    IN_USE: 'Cannot delete a resource in use',
    DEFAULT_RESOURCE: 'TODO: understand the case and add message for "DEFAULT_RESOURCE"'
});

export default class CloudResourceRowViewModel {
    state = ko.observable();
    type = ko.observable();
    name = ko.observable();
    region = ko.observable();
    buckets = ko.observable();
    usage = ko.observable();
    cloudBucket = ko.observable();
    deleteButton = {
        id: ko.observable(),
        text: 'Delete resource',
        active: ko.observable(),
        tooltip: ko.observable(),
        disabled: ko.observable(),
        onToggle: null,
        onDelete: null
    };

    constructor({ onSelectForDelete, onDelete }) {
        this.deleteButton.onToggle = onSelectForDelete;
        this.deleteButton.onDelete = onDelete;
    }

    onState(resource, system, selectedForDelete) {
        const { name, region = unassignedRegionText, usedBy, target, undeletable } = resource;
        const bucketCount = usedBy.length;

        const uri = realizeUri(routes.cloudResource, { system, resource: name });
        const buckets = {
            text: stringifyAmount('bucket', bucketCount),
            tooltip: bucketCount > 0 ? {
                template: 'linkList',
                text: usedBy.map(bucket => ({
                    text: bucket,
                    href: realizeUri(routes.bucket, { system, bucket })
                }))
            } :null
        };
        const deleteTooltip = undeletableReasons[undeletable] || '';

        this.state(getCloudResourceStateIcon(resource));
        this.type(getCloudResourceTypeIcon(resource));
        this.name({ text: name, href: uri });
        this.region({ text: region, tooltip: region });
        this.buckets(buckets);
        this.usage(formatSize(resource.storage.used));
        this.cloudBucket(target);
        this.deleteButton.id(name);
        this.deleteButton.active(selectedForDelete === name);
        this.deleteButton.disabled(Boolean(undeletable));
        this.deleteButton.tooltip(deleteTooltip);
    }
}
