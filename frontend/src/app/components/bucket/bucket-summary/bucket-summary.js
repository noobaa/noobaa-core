import template from './bucket-summary.html';
import ko from 'knockout';
import style from 'style';
import { formatSize } from 'utils';

const cloudSyncStatusMapping = Object.freeze({
    PENDING: { text: 'Sync Pending', icon: 'cloud-pending' } ,
    SYNCING: { text: 'Syncing', icon: 'cloud-syncing' },
    PAUSED: { text: 'Sync Paused', icon: 'cloud-paused' },
    UNABLE: { text: 'Unable to sync', icon: 'cloud-error' },
    SYNCED: { text: 'Sync Completed', icon: 'cloud-synced' },
    NOTSET: { text: 'Cloud sync not set', icon: 'cloud-not-set' }
});

class BucketSummrayViewModel {
    constructor({ bucket }) {
        this.dataReady = ko.pureComputed(
            () => !!bucket()
        );

        this.total = ko.pureComputed(
            () => bucket() && bucket().storage.used
        );

        this.totalText = ko.pureComputed(
            () => bucket() && formatSize(bucket().storage.total)
        );

        this.used = ko.pureComputed(
            () => bucket() && bucket().storage.used
        );

        this.usedText = ko.pureComputed(
            () => bucket() && formatSize(this.used())
        );

        this.free = ko.pureComputed(
            () => bucket() && bucket().storage.free
        );

        this.freeText = ko.pureComputed(
            () => formatSize(this.free())
        );

        this.gaugeValues = [
            { value: this.used, color: style['text-color6'], emphasize: true },
            { value: this.free, color: style['text-color4'] }
        ];

        this.stateText = ko.pureComputed(
            () => 'Healthy'
        );

        this.stateIcon = ko.pureComputed(
            () => '/fe/assets/icons.svg#bucket-healthy'
        );

        let cloudSyncStatus = ko.pureComputed(
            () => bucket() && cloudSyncStatusMapping[bucket().cloud_sync_status]
        );

        this.cloudSyncText = ko.pureComputed(
            () => cloudSyncStatus() && cloudSyncStatus().text
        );

        this.cloudSyncIcon = ko.pureComputed(
            () => cloudSyncStatus() && `/fe/assets/icons.svg#${
                cloudSyncStatus().icon
            }`
        );

        this.hasCloudSyncPolicy = ko.pureComputed(
            () => bucket() && bucket().cloud_sync_status !== 'NOTSET'
        );

        this.dataPlacementIcon = '/fe/assets/icons.svg#policy';
        this.isPolicyModalVisible = ko.observable(false);
        this.isSetCloudSyncModalVisible = ko.observable(false);
        this.isViewCloudSyncModalVisible = ko.observable(false);
    }
}

export default {
    viewModel: BucketSummrayViewModel,
    template: template
};
