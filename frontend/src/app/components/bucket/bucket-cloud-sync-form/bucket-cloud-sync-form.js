import template from './bucket-cloud-sync-form.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import moment from 'moment';
import { cloudSyncInfo } from 'model';
import { removeCloudSyncPolicy, loadCloudSyncInfo, toogleCloudSync } from 'actions';
import { bitsToNumber, formatDuration } from 'utils';

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

class BucketCloudSyncFormViewModel extends BaseViewModel {
    constructor({ bucket }) {
        super();

        this.bucketName = ko.pureComputed(
            () => bucket() && bucket().name
        );

        this.autoDispose(
            this.bucketName.subscribe(
              name => loadCloudSyncInfo(name)
            )
        );

        this.hasCloudSyncPolicy = ko.pureComputed(
            () => !!bucket() && bucket().cloud_sync_status !== 'NOTSET'
        );

        this.toggleSyncButtonLabel = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().status === 'PAUSED' ?
                'Resume' :
                'Pause'
        );

        this.state = ko.pureComputed(
            () => cloudSyncInfo() && syncStateMapping[cloudSyncInfo().status]
        );

        let policy = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().policy
        );

        this.lastSync = ko.pureComputed(
            () => {
                if (!cloudSyncInfo() || cloudSyncInfo().last_sync == 0) {
                    return 'N/A';
                }

                return moment(cloudSyncInfo().last_sync).format(timeFormat);
            }
        );

        this.nextSync = ko.pureComputed(
            () => {
                if (!cloudSyncInfo() ||
                    cloudSyncInfo().status === 'PAUSED' ||
                    cloudSyncInfo().last_sync == 0
                ) {
                    return 'N/A';
                }

                return moment(cloudSyncInfo().last_sync)
                    .add(policy().schedule_min, 'minutes')
                    .format(timeFormat);
            }
        );

        this.targetBucket = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().target_bucket
        );

        this.accessKey = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().access_key
        );

        this.endpoint = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().endpoint
        );

        this.frequancy = ko.pureComputed(
            () => policy() && `Every ${formatDuration(policy().schedule_min)}`
        );

        this.syncDirection = ko.pureComputed(
            () => policy() && directionMapping[
                bitsToNumber(policy().c2n_enabled, policy().n2c_enabled)
            ]
        );

        this.syncDeletions = ko.pureComputed(
            () => policy() && policy().additions_only ? 'No' : 'Yes'
        );

        this.isSetCloudSyncModalVisible = ko.observable(false);
        this.isEditCloudSyncModalVisible = ko.observable(false);

        this.bucketName() && loadCloudSyncInfo(this.bucketName());
    }

    removePolicy() {
        removeCloudSyncPolicy(this.bucketName());
    }

    toggleSync() {
        if (!cloudSyncInfo() || cloudSyncInfo().status === 'NOTSET') {
            return;
        }

        let pause = cloudSyncInfo().status !== 'PAUSED';
        toogleCloudSync(this.bucketName(), pause);
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
