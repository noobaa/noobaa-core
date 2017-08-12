/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { deleteBucket } from'actions';
import { deepFreeze } from 'utils/core-utils';
import { getResourceTypeIcon, getBucketCapacityBarValues } from 'utils/ui-utils';
import { aggregateStorage } from 'utils/storage-utils';
import { formatSize } from 'utils/size-utils';

const stateIconMapping = deepFreeze({
    true: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    },

    false: {
        name: 'problem',
        css: 'error',
        tooltip: 'Not enough healthy storage resources'
    }
});

const cloudSyncStatusMapping = deepFreeze({
    NOTSET: {
        text: 'Not set',
        css: ''
    },
    PENDING: {
        text: 'Waiting',
        css: ''
    },
    SYNCING: {
        text: 'Syncing',
        css: ''
    },
    PAUSED: {
        text: 'Paused',
        css: ''
    },
    SYNCED: {
        text: 'Synced',
        css: ''
    },
    UNABLE: {
        text: 'Unable to sync',
        css: 'error'
    }
});

const placementPolicyTypeMapping = deepFreeze({
    SPREAD: 'Spread',
    MIRROR: 'Mirrored'
});

function storageIcon(bucket, type) {
    const icon = getResourceTypeIcon(type);
    const resources = bucket.backingResources.resources
        .filter(resource => resource.type === type);
    const list = resources.map(resource => resource.name);
    const tooltipText = resources.length === 0 ?
        `No ${icon.tooltip.toLowerCase()}s` :
        { title: `${icon.tooltip}s`, list };

    return {
        name: icon.name,
        tooltip:  { text: tooltipText },
        isHighlighted: !!resources.length
    };
}

export default class BucketRowViewModel extends BaseViewModel {
    constructor() {
        super();

        this.state = ko.observable();
        this.name = ko.observable();
        this.fileCount = ko.observable();
        this.placementPolicy = ko.observable();
        this.resourcesInPolicy = {
            hostsIcon: ko.observable(),
            cloudIcon: ko.observable()
        };
        this.spilloverUsage = ko.observable();
        this.cloudStorage = ko.observable();
        this.cloudSync = ko.observable();
        this.usedCapacity = ko.observable();
        this.deleteButton = ko.observable();
    }

    onUpdate({ bucket, poolByName, deleteGroup, isLastBucket }) {
        const { used = 0, total = 0 } = aggregateStorage(
            ...bucket.backingResources.spillover.map(
                spillover => ({
                    used: spillover.used ? spillover.used : 0,
                    total: poolByName[spillover.name] ? poolByName[spillover.name].storage.total : 0
                })
            )
        );
        const spilloverStorage = { used, total };

        this.state(stateIconMapping[Boolean(bucket.writable)]);
        this.name({
            text: bucket.name,
            href: { route: 'bucket', params: { bucket: bucket.name } }
        });
        this.fileCount(bucket.objectsCount);
        this.placementPolicy({
            text: placementPolicyTypeMapping[bucket.backingResources.type],
            tooltip: bucket.backingResources.resources.map(item => item.name)
        });
        this.resourcesInPolicy.hostsIcon(storageIcon(bucket, 'HOSTS'));
        this.resourcesInPolicy.cloudIcon(storageIcon(bucket, 'CLOUD'));
        this.spilloverUsage(`${formatSize(spilloverStorage.used)} ${spilloverStorage.used ? 'used' : ''}` );
        this.cloudSync(cloudSyncStatusMapping[bucket.cloudSyncStatus]);
        this.usedCapacity(getBucketCapacityBarValues(bucket));
        this.deleteButton({
            subject: 'bucket',
            group: deleteGroup,
            undeletable: ko.pureComputed(
                () => bucket.demoBucket || isLastBucket || bucket.objectsCount
            ),
            tooltip: ko.pureComputed(
                () => {
                    if (bucket.demoBucket) {
                        return 'Demo buckets cannot be deleted';
                    }

                    if (bucket.objectsCount) {
                        return 'Cannot delete a bucket that contain files';
                    }

                    if (isLastBucket) {
                        return 'Last bucket cannot be deleted';
                    }

                    return 'delete bucket';
                }
            ),
            onDelete: () => deleteBucket(bucket.name)
        });

        return this;
    }
}
