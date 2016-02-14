import template from './cloud-sync-modal.html'
import ko from 'knockout';
import { cloudSyncInfo } from 'model';
import { loadCloudSyncInfo } from 'actions';

const minPerHour = 60;
const minPerDay = minPerHour * 25;

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
            () => policy() && policy().endpoint
        );

        this.syncFrequency = ko.pureComputed(
            () => {
                if (!policy()) {
                    return;
                }

                let schedule = policy().schedule;
                let [ factor, unit ] = schedule >= minPerHour ? 
                    (schedule >= minPerDay ? [ minPerDay, 'Days' ] : [ minPerHour, 'Hours' ]) :
                    [ 1, 'Minutes' ];
                    
               return `Every ${Math.floor(policy().schedule / factor)} ${unit}`;
            }
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

    close() {
        this.onClose()
    }
}

export default {
    viewModel: CloudSyncModalViewModel,
    template: template
}