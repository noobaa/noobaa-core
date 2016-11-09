import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze, capitalize, stringifyAmount } from 'utils';
import { deleteBucket } from'actions';

const stateIconMapping = deepFreeze({
    true: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    },

    false: {
        name: 'problem',
        css: 'error',
        tooltip: 'Problem'
    }
});

const cloudSyncStatusMapping = deepFreeze({
    NOTSET: {
        text: 'not set',
        css: ''
    },
    PENDING: {
        text: 'pending',
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
    let count = list.length;
    let name =  `${baseIconName}${count ? '-colored' : ''}`;

    let tooltipText = count === 0 ?
        `No ${tooltipTitle}` :
        { title: capitalize(tooltipTitle), list: list };

    return {
        name: name,
        tooltip: { text: tooltipText }
    };
}

export default class BucketRowViewModel extends Disposable {
    constructor(bucket, deleteGroup, isLastBucket) {
        super();

        this.state = ko.pureComputed(
            () => bucket() ? stateIconMapping[bucket().state || true] : {}
        );

        this.name = ko.pureComputed(
            () => {
                if (!bucket()) {
                    return {};
                }

                let { name } = bucket();
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

        let tierName = ko.pureComputed(
            () => bucket() && bucket().tiering.tiers[0].tier
        );

        let tier = ko.pureComputed(
            () => systemInfo() && systemInfo().tiers.find(
                tier => tier.name === tierName()
            )
        );

        this.placementPolicy = ko.pureComputed(
            () => {
                if (!tier()) {
                    return {};
                }

                let { data_placement, node_pools } = tier();
                let count = node_pools.length;

                let text = `${
                        placementPolicyTypeMapping[data_placement]
                    } on ${
                        stringifyAmount('pool', count)
                    }`;

                return {
                    text: text,
                    tooltip: node_pools
                };
            }
        );

        let cloudPolicy = ko.pureComputed(
            () => {
                let policy = { AWS: [], AZURE: [], S3_COMPATIBLE: [] };
                if (!tier()) {
                    return policy;
                }

                return tier().cloud_pools
                    .map(
                        name => systemInfo().pools.find(
                            pool => pool.name === name
                        )
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
                    'Azure resources'
                )
            ),
            cloudIcon: ko.pureComputed(
                () => cloudStorageIcon(
                    cloudPolicy().S3_COMPATIBLE,
                    'cloud-resource',
                    'generic cloud resorurces'
                )
            )
        };

        let storage = ko.pureComputed(
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
                let state = (bucket() && bucket().cloud_sync) ? bucket().cloud_sync.status : 'NOTSET';
                return cloudSyncStatusMapping[state];
            }
        );

        let hasObjects = ko.pureComputed(
            () => Boolean(bucket() && bucket().num_objects > 0)
        );

        let isDemoBucket = ko.pureComputed(
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
                        return 'Bucket not empty';
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
