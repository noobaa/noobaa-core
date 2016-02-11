import ko from 'knockout';
import numeral from 'numeral';
import { formatSize, isDefined } from 'utils';
import { deleteBucket } from'actions';

const stateMapping = Object.freeze({
    true: {
        toolTip: 'healthy',
        icon: '/fe/assets/icons.svg#bucket-healthy'
    },

    false: {
        toolTip: 'problem',
        icon: '/fe/assets/icons.svg#bucket-problam'
    }
});

const cloudSyncStatusMapping = Object.freeze({
    [undefined]:    { label: 'N/A',             css: ''               },
    NOTSET:         { label: 'not set',         css: 'no-set'         },
    UNSYNCED:       { label: 'unsynced',        css: 'unsynced'       },
    SYNCING:        { label: 'syncing',         css: 'syncing'        },
    PASUED:         { label: 'paused',          css: 'paused'         },
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

        this.totalSize = ko.pureComputed(
            () => {
                if (bucket()) {                
                    let storage = bucket().storage;
                    return isDefined(storage) ? formatSize(storage.total) : 'N/A';
                }
            }
        );

        this.freeSize = ko.pureComputed(
            () => {
                if (bucket()) {
                    let storage = bucket().storage;
                    return isDefined(storage) ? formatSize(storage.free) : 'N/A';
                }
            }
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