import ko from 'knockout';
import numeral from 'numeral';
import { isDefined } from 'utils';
import { deleteBucket } from'actions';

const stateMapping = Object.freeze({
    true: {
        toolTip: 'Healthy',
        icon: '/fe/assets/icons.svg#bucket-healthy'
    },

    false: {
        toolTip: 'Problem',
        icon: '/fe/assets/icons.svg#bucket-problem'
    }
});

const cloudSyncStatusMapping = Object.freeze({
    [undefined]:    { label: 'N/A',             css: ''               },
    NOTSET:         { label: 'not set',         css: 'no-set'         },
    PENDING:        { label: 'pending',         css: 'pending'       },
    SYNCING:        { label: 'syncing',         css: 'syncing'        },
    PAUSED:         { label: 'paused',          css: 'paused'         },
    SYNCED:         { label: 'synced',          css: 'synced'         },
    UNABLE:         { label: 'unable to sync',  css: 'unable-to-sync' }
});

export default class BucketRowViewModel {
    constructor(bucket, isLastBucket) {
        this.isVisible = ko.pureComputed(
            () => !!bucket()
        );

        let stateMap = ko.pureComputed(
            () => bucket() && stateMapping[bucket().state || true]
        );

        this.stateToolTip = ko.pureComputed(
            () => stateMap() && stateMap().toolTip
        );

        this.stateIcon = ko.pureComputed(
            () => stateMap() && stateMap().icon
        );

        this.name = ko.pureComputed(
            () => bucket() && bucket().name
        );

        this.href = ko.pureComputed(
            () => bucket() && `/fe/systems/:system/buckets/${bucket().name}`
        );

        this.fileCount = ko.pureComputed(
            () => {
                if (bucket()) {
                    let count = bucket().num_objects;
                    return isDefined(count) ? numeral(count).format('0,0') : 'N/A';
                }

            }
        );

        this.total = ko.pureComputed(
            () => bucket() && bucket().storage.total
        );

        this.used = ko.pureComputed(
            () => bucket() && bucket().storage.used
        );

        this.cloudSyncStatus = ko.pureComputed(
            () => bucket() && cloudSyncStatusMapping[bucket().cloud_sync_status]
        );


        let hasObjects = ko.pureComputed(
            () => bucket() && bucket().num_objects > 0
        );

        this.isDeletable = ko.pureComputed(
            () => !isLastBucket() && !hasObjects()
        );

        this.deleteToolTip = ko.pureComputed(
            () => isLastBucket() ?
                 'Cannot delete last bucket' :
                 (hasObjects() ? 'bucket not empty' : 'delete bucket')
        );
    }

    del() {
        deleteBucket(this.name());
    }
}
