import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deleteBucket } from'actions';
import { deepFreeze, keyByProperty } from 'utils/core-utils';
import { capitalize, stringifyAmount } from 'utils/string-utils';

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
        text: 'not set',
        css: ''
    },
    PENDING: {
        text: 'waiting',
        css: ''
    },
    SYNCING: {
        text: 'syncing',
        css: ''
    },
    PAUSED: {
        text: 'paused',
        css: ''
    },
    SYNCED: {
        text: 'synced',
        css: ''
    },
    UNABLE: {
        text: 'unable to sync',
        css: 'error'
    }
});

const placementPolicyTypeMapping = deepFreeze({
    SPREAD: 'Spread',
    MIRROR: 'Mirrored'
});

function cloudStorageIcon(list, baseIconName, tooltipTitle) {
    const count = list.length;
    const name =  `${baseIconName}${count ? '-colored' : ''}`;
    const tooltipText = count === 0 ?
        `No ${tooltipTitle}` :
        { title: capitalize(tooltipTitle), list: list };

    return {
        name: name,
        tooltip: { text: tooltipText }
    };
}

export default class BucketRowViewModel extends BaseViewModel {
    constructor(bucket, deleteGroup, isLastBucket) {
        super();

        this.state = ko.pureComputed(
            () => stateIconMapping[
                Boolean(bucket() && bucket().writable)
            ]
        );

        this.name = ko.pureComputed(
            () => {
                if (!bucket()) {
                    return {};
                }

                const { name } = bucket();
                return {
                    text: name,
                    href: { route: 'bucket', params: { bucket: name } }
                };
            }
        );

        this.fileCount = ko.pureComputed(
            () => {
                if (!bucket()) {
                    return 0;
                }

                return bucket().num_objects;
            }
        )
        .extend({
            formatNumber: true
        });

        const tierName = ko.pureComputed(
            () => bucket() && bucket().tiering.tiers[0].tier
        );

        const tier = ko.pureComputed(
            () => systemInfo() && systemInfo().tiers.find(
                tier => tier.name === tierName()
            )
        );

        this.placementPolicy = ko.pureComputed(
            () => {
                if (!tier()) {
                    return {};
                }

                const { data_placement, attached_pools } = tier();
                const count = attached_pools.length;
                const text = `${
                        placementPolicyTypeMapping[data_placement]
                    } on ${
                        stringifyAmount('pool', count)
                    }`;

                return {
                    text: text,
                    tooltip: attached_pools
                };
            }
        );

        const cloudPolicy = ko.pureComputed(
            () => {
                const policy = { AWS: [], AZURE: [], S3_COMPATIBLE: [] };
                if (!tier()) {
                    return policy;
                }

                const poolsByName = keyByProperty(systemInfo().pools, 'name');
                return tier().attached_pools
                    .map(
                        poolName => poolsByName[poolName]
                    )
                    .filter(
                        pool => Boolean(pool.cloud_info)
                    )
                    .reduce(
                        (mapping, pool) => {
                            mapping[pool.cloud_info.endpoint_type].push(pool.name);
                            return mapping;
                        },
                        policy
                    );
            }
        );

        this.cloudStorage = {
            awsIcon: ko.pureComputed(
                () => cloudStorageIcon(
                    cloudPolicy().AWS,
                    'aws-s3-resource',
                    'AWS S3 resources'
                )
            ),
            azureIcon: ko.pureComputed(
                () => cloudStorageIcon(
                    cloudPolicy().AZURE,
                    'azure-resource',
                    'Azure blob resources'
                )
            ),
            cloudIcon: ko.pureComputed(
                () => cloudStorageIcon(
                    cloudPolicy().S3_COMPATIBLE,
                    'cloud-resource',
                    'generic S3 compatible resorurces'
                )
            )
        };

        const storage = ko.pureComputed(
            () => bucket() ? bucket().storage : {}
        );

        this.capacity = {
            total: ko.pureComputed(
                () => storage().total
            ),
            used: ko.pureComputed(
                () => storage().used
            )
        };


        this.cloudSync = ko.pureComputed(
            () => {
                const state = (bucket() && bucket().cloud_sync) ? bucket().cloud_sync.status : 'NOTSET';
                return cloudSyncStatusMapping[state];
            }
        );

        const hasObjects = ko.pureComputed(
            () => Boolean(bucket() && bucket().num_objects > 0)
        );

        const isDemoBucket = ko.pureComputed(
            () => Boolean(bucket() && bucket().demo_bucket)
        );

        this.deleteButton = {
            subject: 'bucket',
            group: deleteGroup,
            undeletable: ko.pureComputed(
                () => isDemoBucket() || isLastBucket() || hasObjects()
            ),
            tooltip: ko.pureComputed(
                () => {
                    if (isDemoBucket()) {
                        return 'Demo buckets cannot be deleted';
                    }

                    if (hasObjects()) {
                        return 'Cannot delete a bucket that contain files';
                    }

                    if (isLastBucket()) {
                        return 'Last bucket cannot be deleted';
                    }

                    return 'delete bucket';
                }
            ),
            onDelete: () => deleteBucket(bucket().name)
        };
    }
}
