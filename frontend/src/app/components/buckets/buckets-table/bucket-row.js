/* Copyright (C) 2016 NooBaa */

import ko from 'knockout';
import numeral from 'numeral';
import { deepFreeze, flatMap } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { formatSize } from 'utils/size-utils';
import {
    getBucketStateIcon,
    getPlacementTypeDisplayName
} from 'utils/bucket-utils';

const undeletableReasons = deepFreeze({
    LAST_BUCKET: 'Last bucket cannot be deleted',
    NOT_EMPTY: 'Cannot delete a bucket that contain files'
});

const resourceGroupMetadata = deepFreeze({
    HOSTS: {
        icon: 'nodes-pool',
        tooltipTitle: 'Nodes pool resources'
    },
    CLOUD: {
        icon: 'cloud-hollow',
        tooltipTitle: 'Cloud resources'
    }
});

function _mapResourceGroups(placement) {
    const resources = flatMap(placement.mirrorSets, ms => ms.resources);
    return Object.keys(resourceGroupMetadata)
        .map(type => {
            const { icon, tooltipTitle } = resourceGroupMetadata[type];
            const group = resources.filter(res => res.type === type);
            const hasResources = group.length > 0;
            const tooltipText = hasResources ?
                { title: tooltipTitle, list: group.map(res => res.name) } :
                `No ${tooltipTitle.toLowerCase()}`;

            return {
                icon: icon,
                lighted: hasResources > 0,
                tooltip: { text: tooltipText }
            };
        });
}

export default class BucketRowViewModel {
    constructor({ baseRoute, deleteGroup, onDelete }) {
        this.baseRoute = baseRoute;
        this.name = ko.observable();
        this.state = ko.observable();
        this.objectCount = ko.observable();
        this.placementPolicy = ko.observable();
        this.resources = ko.observable();
        this.spilloverUsage = ko.observable();
        this.totalCapacity = ko.observable();
        this.usedCapacity = ko.observable();

        this.capacity = {
            total: this.totalCapacity,
            used: this.usedCapacity
        };

        this.deleteButton = {
            subject: 'bucket',
            disabled: ko.observable(),
            tooltip: ko.observable(),
            id: ko.observable(),
            group: deleteGroup,
            onDelete: onDelete
        };
    }

    onBucket(bucket) {
        const name = {
            text: bucket.name,
            href: realizeUri(this.baseRoute, { bucket: bucket.name }),
            tooltip: {
                text: bucket.name,
                breakWords: true
            }
        };

        const spillover = formatSize(bucket.spillover ? bucket.spillover.usage : 0);

        this.state(getBucketStateIcon(bucket, 'start'));
        this.name(name);
        this.objectCount(numeral(bucket.objectCount).format('0,0'));
        this.placementPolicy(getPlacementTypeDisplayName(bucket.placement.policyType));
        this.resources(_mapResourceGroups(bucket.placement));
        this.spilloverUsage(spillover);
        this.totalCapacity(bucket.storage.total);
        this.usedCapacity(bucket.storage.used);
        this.deleteButton.id(bucket.name);
        this.deleteButton.disabled(Boolean(bucket.undeletable));
        this.deleteButton.tooltip(bucket.undeletable ? undeletableReasons[bucket.undeletable] : '');
    }
}
