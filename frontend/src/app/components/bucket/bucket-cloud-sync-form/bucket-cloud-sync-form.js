import template from './bucket-cloud-sync-form.html';
import ko from 'knockout';
import { cloudSyncInfo } from 'model';
import{ removeCloudSyncPolicy, loadCloudSyncInfo } from 'actions';

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

        this.syncStatus = ko.pureComputed(
            () => 'Synced'
        );

        this.lastSync = ko.pureComputed(
            () => 'Feb, 25 at 06:09:33'
        );

        this.nextSync = ko.pureComputed(
            () => 'Feb, 25 at 06:09:33'
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
            () => 'Every 19 mins'
        );

        this.syncDirection = ko.pureComputed(
            () => 'Bi-Directional'
        );

        this.syncDeletions = ko.pureComputed(
            () => 'Yes'
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