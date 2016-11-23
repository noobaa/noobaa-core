import template from './bucket-cloud-sync-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment';
import { removeCloudSyncPolicy, toogleCloudSync } from 'actions';
import { bitsToNumber, formatDuration } from 'utils/all';

const timeFormat = 'MMM, DD [at] hh:mm:ss';

const syncStateMapping = Object.freeze({
    PENDING: 'Sync Pending',
    SYNCING: 'Syncing',
    PAUSED: 'Sync Paused',
    UNABLE: 'Unable to sync',
    SYNCED: 'Sync Completed'
});

const directionMapping = Object.freeze({
    1: 'Source to target',
    2: 'Target to source',
    3: 'Bi directional'
});

class BucketCloudSyncFormViewModel extends Disposable {
    constructor({ bucket }) {
        super();

        this.bucketName = ko.pureComputed(
            () => bucket() && bucket().name
        );

        let cloudSyncInfo = ko.pureComputed(
            () => bucket() && bucket().cloud_sync
        );

        this.hasCloudSync = ko.pureComputed(
            () => Boolean(cloudSyncInfo())
        );

        this.isPaused = ko.pureComputed(
            () => this.hasCloudSync() && cloudSyncInfo().status === 'PAUSED'
        );

        this.toggleSyncButtonLabel = ko.pureComputed(
            () => this.isPaused() ? 'Resume' : 'Pause'
        );

        let state = ko.pureComputed(
            () => cloudSyncInfo() && syncStateMapping[cloudSyncInfo().status]
        );

        let policy = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().policy
        );

        let lastSync = ko.pureComputed(
            () => {
                if (!cloudSyncInfo() || cloudSyncInfo().last_sync == 0) {
                    return 'N/A';
                }

                return moment(cloudSyncInfo().last_sync).format(timeFormat);
            }
        );

        let nextSync = ko.pureComputed(
            () => {
                if (!this.hasCloudSync() ||
                    this.isPaused() ||
                    cloudSyncInfo().last_sync == 0
                ) {
                    return 'N/A';
                }

                return moment(cloudSyncInfo().last_sync)
                    .add(policy().schedule_min, 'minutes')
                    .format(timeFormat);
            }
        );

        this.statusDetails = [
            { label: 'Sync Status', value: state },
            { label: 'Last sync', value: lastSync },
            { label: 'Next Sync', value: nextSync }
        ];

        let endpoint = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().endpoint
        );

        let accessKey = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().access_key
        );

        let targetBucket = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().target_bucket
        );

        this.connectionDetails = [
            { label: 'Endpoint', value: endpoint },
            { label: 'Access key', value: accessKey },
            { label: 'Target bucket', value: targetBucket }
        ];

        let frequancy = ko.pureComputed(
            () => policy() && `Every ${formatDuration(policy().schedule_min)}`
        );

        let syncDirection = ko.pureComputed(
            () => policy() && directionMapping[
                bitsToNumber(policy().c2n_enabled, policy().n2c_enabled)
            ]
        );

        let syncDeletions = ko.pureComputed(
            () => policy() && policy().additions_only ? 'No' : 'Yes'
        );

        this.syncPolicy = [
            { label: 'Frequency', value: frequancy },
            { label: 'Direction', value: syncDirection },
            { label: 'Sync Deletions', value: syncDeletions }
        ];

        this.isSetCloudSyncModalVisible = ko.observable(false);
        this.isEditCloudSyncModalVisible = ko.observable(false);
    }

    removePolicy() {
        removeCloudSyncPolicy(this.bucketName());
    }

    toggleSync() {
        if (this.hasCloudSync()) {
            toogleCloudSync(this.bucketName(), !this.isPaused());
        }
    }

    showSetCloudSyncModal() {
        this.isSetCloudSyncModalVisible(true);
    }

    hideSetCloudSyncModal() {
        this.isSetCloudSyncModalVisible(false);
    }

    showEditCloudSyncModal() {
        this.isEditCloudSyncModalVisible(true);
    }

    hideEditCloudSyncModal() {
        this.isEditCloudSyncModalVisible(false);
    }
}

export default {
    viewModel: BucketCloudSyncFormViewModel,
    template: template
};
