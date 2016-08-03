import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
import { systemInfo } from 'model';
import { deepFreeze, isDefined } from 'utils';
import { deleteBucket } from'actions';

const stateIconMapping = deepFreeze({
    true: {
        tooltip: 'Healthy',
        name: 'bucket-healthy'
    },

    false: {
        tooltip: 'Problem',
        name: 'bucket-problem'
    }
});

const cloudSyncStatusMapping = deepFreeze({
    [undefined]:    { text: 'N/A',             css: ''               },
    NOTSET:         { text: 'not set',         css: 'no-set'         },
    PENDING:        { text: 'pending',         css: 'pending'       },
    SYNCING:        { text: 'syncing',         css: 'syncing'        },
    PAUSED:         { text: 'paused',          css: 'paused'         },
    SYNCED:         { text: 'synced',          css: 'synced'         },
    UNABLE:         { text: 'unable to sync',  css: 'unable-to-sync' }
});

const policyTypeMapping = deepFreeze({
    SPREAD: 'Spread',
    MIRROR: 'Mirrored'
});

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
                    return {};
                }

                let count = bucket().num_objects;
                return isDefined(count) ? numeral(count).format('0,0') : 'N/A';
            }
        );

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
                if (tier()) {
                    let { data_placement, node_pools } = tier();
                    let count = node_pools.length;

                    let text = `${
                        policyTypeMapping[data_placement]
                    } on ${count} pool${count === 1 ? '' : 's'}`;

                    let tooltip = count === 1 ?
                        node_pools[0] :
                        `<ul>${
                            node_pools.map(
                                name => `<li>${name}</li>`
                            ).join('')
                        }</ul>`;


                    return  { text, tooltip };
                }
            }
        );

        this.capacity = ko.pureComputed(
            () => bucket() ? bucket().storage : ''
        );


        this.cloudSync = ko.pureComputed(
            () => bucket() ? cloudSyncStatusMapping[bucket().cloud_sync_status] : ''
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
            deleteToolTip: ko.pureComputed(
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
