/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import { stringifyAmount } from 'utils/string-utils';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getNamespaceResourceStateIcon, getNamespaceResourceTypeIcon } from 'utils/resource-utils';
import * as routes from 'routes';

const undeletableReasonToTooltip = deepFreeze({
    IN_USE: 'Cannot delete a resource which is used by a namespace bucket'
});

export default class ResourceRowViewModel {
    constructor({ deleteGroup, onDelete }) {
        this.state = ko.observable();
        this.type = ko.observable();
        this.name = ko.observable();
        this.connectedBuckets = ko.observable();
        this.target = ko.observable();
        this.deleteButton = {
            subject: 'resource',
            id: ko.observable(),
            disabled: ko.observable(),
            tooltip: ko.observable(),
            group: deleteGroup,
            onDelete: onDelete
        };
    }

    onState(resource, connectedBuckets, system) {
        const { name, target, undeletable } = resource;
        const conenctedBucketsInfo = {
            text: stringifyAmount('bucket', connectedBuckets.length),
            tooltip: {
                template: 'linkList',
                text: connectedBuckets.length > 0 ?
                    connectedBuckets.map(bucket => ({
                        text: bucket,
                        href: realizeUri(routes.namespaceBucket, { system, bucket })
                    })) :
                    null
            }
        };
        const deleteTooltip = undeletableReasonToTooltip[undeletable] || 'Delete Resource';

        this.state(getNamespaceResourceStateIcon(resource));
        this.type(getNamespaceResourceTypeIcon(resource));
        this.name(name);
        this.connectedBuckets(conenctedBucketsInfo);
        this.target({ text: target, tooltip: target });
        this.deleteButton.id(name);
        this.deleteButton.disabled(Boolean(undeletable));
        this.deleteButton.tooltip(deleteTooltip);
    }
}
