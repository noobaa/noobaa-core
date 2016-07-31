import Disposable from 'disposable';
import ko from 'knockout';
import numeral from 'numeral';
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

export default class BucketRowViewModel extends Disposable {
    constructor(bucket, deleteGroup, isLastBucket) {
        super();

        this.state = ko.pureComputed(
            () => bucket() && stateIconMapping[bucket().state || true]
        );

        this.name = ko.pureComputed(
            () => {
                if (!bucket()) {
                    return;
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
                if (bucket()) {
                    let count = bucket().num_objects;
                    return isDefined(count) ? numeral(count).format('0,0') : 'N/A';
                }
            }
        );

        this.capacity = ko.pureComputed(
            () => bucket && bucket().storage
        );


        this.cloudSync = ko.pureComputed(
            () => bucket() && cloudSyncStatusMapping[bucket().cloud_sync_status]
        );


        let hasObjects = ko.pureComputed(
            () => !!bucket() && bucket().num_objects > 0
        );

        this.deleteButton = {
            deleteGroup: deleteGroup,
            undeletable: ko.pureComputed(
                () => isLastBucket() || hasObjects()
            ),
            deleteToolTip: ko.pureComputed(
                () => isLastBucket() ?
                    'Cannot delete last bucket' :
                    (hasObjects() ? 'bucket not empty' : 'delete bucket')
            ),
            onDelete: () => this.del()
        };
    }


    del() {
        deleteBucket(this.name());
    }
}
