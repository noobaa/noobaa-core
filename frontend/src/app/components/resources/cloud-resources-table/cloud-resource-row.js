/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { deleteCloudResource } from 'actions';
import { getResourceTypeIcon, getPoolStateIcon } from 'utils/ui-utils';

const undeletableReasons = deepFreeze({
    IN_USE: 'Cannot delete a resource which is used in a bucket data placement policy'
});

export default class CloudResourceRowViewModel extends BaseViewModel {
    constructor(resource, resourcesToBuckets, deleteGroup) {
        super();

        this.state = ko.pureComputed(
            () => {
                if (!resource()) {
                    return '';
                }

                const icon = getPoolStateIcon(resource());
                return {
                    ...icon,
                    tooltip: {
                        text: icon.tooltip,
                        align: 'start'
                    }
                };
            }
        );

        this.type = ko.pureComputed(
            () => resource() ? getResourceTypeIcon(resource()) : ''
        );

        this.name = ko.pureComputed(
            () => resource() ? resource().name : ''
        );

        this.buckets = ko.pureComputed(
            () => {
                let buckets = resourcesToBuckets()[this.name()] || [];
                let count = buckets.length;

                return {
                    text: `${count} bucket${count != 1 ? 's' : ''}`,
                    tooltip: count ? buckets : null
                };
            }
        );

        this.usage = ko.pureComputed(
            () => resource() && resource().storage.used
        ).extend({
            formatSize: true
        });

        this.cloudBucket = ko.pureComputed(
            () => resource() ? resource().cloud_info.target_bucket : ''
        );

        let undeletable = ko.pureComputed(
            () => resource() ? resource().undeletable : ''
        );

        this.deleteBtn = {
            subject: 'resources',
            group: deleteGroup,
            disabled: undeletable,
            tooltip: ko.pureComputed(
                () => undeletable() ? undeletableReasons[undeletable()] : 'delete resources'
            ),
            onDelete: () => deleteCloudResource(this.name())
        };
    }
}
