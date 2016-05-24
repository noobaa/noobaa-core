import template from './bucket-cloud-sync-form.html';
import ko from 'knockout';
import moment from 'moment';
import { cloudSyncInfo } from 'model';
import{ removeCloudSyncPolicy, loadCloudSyncInfo } from 'actions';

const timeFormat = 'MMM, DD [at] hh:mm:ss';

const syncStateMapping = Object.freeze({
    UNSYNCED: 'Sync Pending',
    SYNCING: 'Syncing',
    PASUED: 'Sync Paused',
    UNABLE: 'Unable to sync',
    SYNCED: 'Sync Completed'
});

const directionMapping = Object.freeze({
    '01': 'Target to source',
    '10': 'Source to target',
    '11': 'Bi Directionaxl'
})

class BucketCloudSyncFormViewModel {
    constructor({ bucket }) {
        this.bucketName = ko.pureComputed(
            () => bucket() && bucket().name
        );

        this.nameSub = this.bucketName.subscribe(
            name => loadCloudSyncInfo(name)
        );

        this.hasCloudSyncPolicy = ko.pureComputed(
            () => !!bucket() && bucket().cloud_sync_status !== 'NOTSET'
        );

        this.state = ko.pureComputed(
            () => cloudSyncInfo() && syncStateMapping[cloudSyncInfo().status]
        );

        let policy = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().policy
        )

        this.lastSync = ko.pureComputed(
            () => !!cloudSyncInfo() ?
                moment(cloudSyncInfo().last_sync).format(timeFormat) :
                'N/A'
        );

        this.nextSync = ko.pureComputed(
            () => null
        //     () => !!cloudSyncInfo() ?
        //         moment(cloudSyncInfo().last_sync)
        //             .add(policy().schedule, 'minutes')
        //             .format(timeFormat) :
        //         'N/A'
        );

        this.connection = ko.pureComputed(
            () => 'Connection 1'
        );

        this.targetBucket = ko.pureComputed(
            () => 'other bucket'
        )

        this.accessKey = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().access_key
        );

        this.endpoint = ko.pureComputed(
            () => cloudSyncInfo() && cloudSyncInfo().endpoint
        );

        this.frequancy = ko.pureComputed(
            () => policy() && `Every ${
                moment().add(policy().schedule, 'minutes')
                    .fromNow(true)
                    .replace(/^(a|an)\s+/, '')
            }`
        );

        this.syncDirection = ko.pureComputed(
            () => null
            // () => policy() && directionMapping[
            //     policy().'Bi-Directional
            // ]'
        );

        this.syncDeletions = ko.pureComputed(
            () => policy() && policy().additions_only ? 'No' : 'Yes'
        );

        this.isSetCloudSyncModalVisible = ko.observable(false);

        this.bucketName() && loadCloudSyncInfo(this.bucketName());
    }

    removePolicy() {
        removeCloudSyncPolicy(this.bucketName());
    }

    showSetCloudSyncModal() {
        this.isSetCloudSyncModalVisible(true);
    }

    hideSetCloudSyncModal() {
        this.isSetCloudSyncModalVisible(false);
    }

    dispose() {
        this.nameSub.dispose();
    }
}

export default {
    viewModel: BucketCloudSyncFormViewModel,
    template: template,
}