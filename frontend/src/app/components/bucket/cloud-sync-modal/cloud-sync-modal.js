import template from './cloud-sync-modal.html'
import ko from 'knockout';
import { cloudSyncInfo } from 'model';
import { loadCloudSyncInfo, removeCloudSyncPolicy } from 'actions';
import { formatDuration } from 'utils';

const syncStatusMapping = Object.freeze({
    [undefined]:    { label: 'N/A',             css: ''               },
    NOTSET:         { label: 'Not Set',         css: 'no-set'         },
    UNSYNCED:       { label: 'Unsynced',        css: 'unsynced'       },
    SYNCING:        { label: 'Syncing',         css: 'syncing'        },
    PASUED:         { label: 'Paused',          css: 'paused'         },
    SYNCED:         { label: 'Synced',          css: 'synced'         },
    UNABLE:         { label: 'Unable To Sync',  css: 'unable-to-sync' }
});

class CloudSyncModalViewModel {
    constructor({ bucketName, onClose }) {
        this.bucketName = bucketName;
        this.onClose = onClose;

        let policy = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().policy
        );

        this.syncStatus = ko.pureComputed(
            () => syncStatusMapping[cloudSyncInfo() && cloudSyncInfo().status]
        );

        this.accessKey = ko.pureComputed(
            () => policy() && policy().access_keys[0].access_key
        );

        this.awsBucket = ko.pureComputed(
            () => policy() && policy().target_bucket
        );

        this.syncFrequency = ko.pureComputed(
            () => policy() && `Every ${formatDuration(policy().schedule)}`
        );

        this.syncDirection = ko.pureComputed(
            () => {
                if (!policy()) {
                    return;
                }

                let { n2c_enabled, c2n_enabled } = policy();
                return n2c_enabled ?
                    (c2n_enabled ? 'Bi-Direcitonal' : 'AWS to NooBaa') :
                    'NooBaa to AWS';
            }
        );

        this.syncDeletions = ko.pureComputed(
            () => policy() && !policy().additions_only
        );

        loadCloudSyncInfo(ko.unwrap(bucketName));
    }

    removePolicy() {
        removeCloudSyncPolicy(ko.unwrap(this.bucketName));
        this.onClose();
    }

    close() {
        this.onClose()
    }
}

export default {
    viewModel: CloudSyncModalViewModel,
    template: template
}
