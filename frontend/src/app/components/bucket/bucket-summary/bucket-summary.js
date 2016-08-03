import template from './bucket-summary.html';
import Disposable from 'disposable';
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

class BucketSummrayViewModel extends Disposable {
    constructor({ bucket }) {
        super();

        this.dataReady = ko.pureComputed(
            () => !!bucket()
        );

        this.total = ko.pureComputed(
            () => bucket() && bucket().storage.used
        );

        this.totalText = ko.pureComputed(
            () => bucket() && formatSize(bucket().storage.total)
        );

        let storage = ko.pureComputed(
            () => bucket() ? bucket().storage : {}
        );

        this.barsValues = [
            {
                label: 'Physical size',
                value: ko.pureComputed(
                    () => storage().real
                ),
                color: style['text-color5']
            },
            {
                label: 'Size',
                value: ko.pureComputed(
                    () => storage().used
                ),
                color: style['text-color6']
            }
        ];

        this.pieValues = [
            {
                label: 'Used (this bucket)',
                value: ko.pureComputed(
                    () => storage().used
                ),
                color: style['text-color6']
            },
            {
                label: 'Used (other buckets)',
                value: ko.pureComputed(
                    () => storage().used_other
                ),
                color: style['text-color5']
            },
            {
                label: 'Potential available',
                value: ko.pureComputed(
                    () => storage().free
                ),
                color: style['text-color4']
            }
        ];

        this.stateText = ko.pureComputed(
            () => 'Healthy'
        );

        this.stateIcon = ko.pureComputed(
            () => 'bucket-healthy'
        );

        let cloudSyncStatus = ko.pureComputed(
            () => bucket() && cloudSyncStatusMapping[bucket().cloud_sync_status]
        );

        this.cloudSyncText = ko.pureComputed(
            () => cloudSyncStatus() && cloudSyncStatus().text
        );

        this.cloudSyncIcon = ko.pureComputed(
            () => cloudSyncStatus() && cloudSyncStatus().icon
        );

        this.hasCloudSyncPolicy = ko.pureComputed(
            () => bucket() && bucket().cloud_sync_status !== 'NOTSET'
        );

        this.dataPlacementIcon = 'policy';
        this.isPolicyModalVisible = ko.observable(false);
        this.isSetCloudSyncModalVisible = ko.observable(false);
        this.isViewCloudSyncModalVisible = ko.observable(false);
    }
}

export default {
    viewModel: BucketSummrayViewModel,
    template: template
};
