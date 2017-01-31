import template from './bucket-cloud-sync-form.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import moment from 'moment';
import { removeCloudSyncPolicy, toogleCloudSync } from 'actions';
import { bitsToNumber } from 'utils/core-utils';
import { formatDuration } from 'utils/string-utils';

const timeFormat = 'MMM, DD [at] hh:mm:ss';

const syncStateMapping = Object.freeze({
    PENDING: 'Waiting for sync',
    SYNCING: 'Syncing',
    UNABLE: 'Unable to sync',
    SYNCED: 'Sync completed'
});

const directionMapping = Object.freeze({
    1: 'Source to target',
    2: 'Target to source',
    3: 'Bi directional'
});

class BucketCloudSyncFormViewModel extends BaseViewModel {
    constructor({ bucket }) {
        super();

        const cloudSyncInfo = ko.pureComputed(
            () => bucket() && bucket().cloud_sync
        );

        const state = ko.pureComputed(
            () => cloudSyncInfo() && syncStateMapping[cloudSyncInfo().status]
        );

        const policy = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().policy
        );

        this.bucketName = ko.pureComputed(
            () => bucket() && bucket().name
        );


        this.hasCloudSync = ko.pureComputed(
            () => Boolean(cloudSyncInfo())
        );

        this.isPaused = ko.pureComputed(
            () => this.hasCloudSync() && policy().paused
        );

        this.toggleSyncButtonLabel = ko.pureComputed(
            () => `${this.isPaused() ? 'Resume' : 'Pause'} Schedule`
        );

        const lastSync = ko.pureComputed(
            () => {
                if (!this.hasCloudSync()){
                    return 'N/A';
                }

                const { last_sync } = cloudSyncInfo();
                if (!last_sync) {
                    return 'No previous sync';
                }

                return moment(last_sync).format(timeFormat);
            }
        );

        const nextSync = ko.pureComputed(
            () => {
                if (!this.hasCloudSync()){
                    return 'N/A';
                }

                if (this.isPaused()) {
                    return '<span class="warning">Paused by user</span>';
                }

                if (cloudSyncInfo().status === 'PENDING') {
                    return 'In a few moments';
                }

                return moment(cloudSyncInfo().last_sync)
                    .add(policy().schedule_min, 'minutes')
                    .format(timeFormat);
            }
        );

        this.statusDetails = [
            {
                label: 'Sync Status',
                value: state
            },
            {
                label: 'Last sync',
                value: lastSync
            },
            {
                label: 'Next Scheduled Sync',
                value: nextSync
            }
        ];

        const endpoint = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().endpoint
        );

        const accessKey = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().access_key
        );

        const targetBucket = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().target_bucket
        );

        this.connectionDetails = [
            {
                label: 'Endpoint',
                value: endpoint
            },
            {
                label: 'Access key',
                value: accessKey
            },
            {
                label: 'Target bucket',
                value: targetBucket
            }
        ];

        const frequancy = ko.pureComputed(
            () => policy() && `Every ${formatDuration(policy().schedule_min)}`
        );

        const syncDirection = ko.pureComputed(
            () => policy() && directionMapping[
                bitsToNumber(policy().c2n_enabled, policy().n2c_enabled)
            ]
        );

        const syncDeletions = ko.pureComputed(
            () => policy() && policy().additions_only ? 'No' : 'Yes'
        );

        this.syncPolicy = [
            {
                label: 'Frequency',
                value: frequancy
            },
            {
                label: 'Direction',
                value: syncDirection
            },
            {
                label: 'Sync Deletions',
                value: syncDeletions
            }
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
