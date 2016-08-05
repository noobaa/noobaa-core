import template from './bucket-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';
import { deepFreeze, formatSize } from 'utils';

const cloudSyncStatusMapping = deepFreeze({
    PENDING: { text: 'Sync Pending', icon: 'cloud-pending' } ,
    SYNCING: { text: 'Syncing', icon: 'cloud-syncing' },
    PAUSED: { text: 'Sync Paused', icon: 'cloud-paused' },
    UNABLE: { text: 'Unable to sync', icon: 'cloud-error' },
    SYNCED: { text: 'Sync Completed', icon: 'cloud-synced' },
    NOTSET: { text: 'Cloud sync not set', icon: 'cloud-not-set' }
});

const graphOptions = deepFreeze([
    {
        label: 'Storage',
        value: 'STORAGE'
    },
    {
        label: 'Data',
        value: 'DATA'
    }
]);

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

        this.graphOptions = graphOptions;
        this.selectedGraph = ko.observable(graphOptions[0].value);

        this.dataValues = [
            {
                label: 'Physical size',
                value: ko.pureComputed(
                    () => storage().real
                ),
                color: style['gray-lv5']
            },
            {
                label: 'Size',
                value: ko.pureComputed(
                    () => storage().used
                ),
                color: style['magenta-mid']
            }
        ];

        this.storageValues = [
            {
                label: 'Used (this bucket)',
                color: style['magenta-mid'],
                value: ko.pureComputed(
                    () => storage().used
                )
            },
            {
                label: 'Used (other buckets)',
                color: style['white'],
                value: ko.pureComputed(
                    () => storage().used_other
                )
            },
            {
                label: 'Potential available',
                color: style['gray-lv5'],
                value: ko.pureComputed(
                    () => storage().free
                )
            }
        ];

        this.legend = ko.pureComputed(
            () => this.selectedGraph() === 'STORAGE' ?
                this.storageValues :
                this.dataValues
        );

        this.stateText = ko.pureComputed(
            () => 'Healthy'
        );

        this.stateIcon = ko.pureComputed(
            () => 'bucket-healthy'
        );

        let cloudSyncStatus = ko.pureComputed(
            () => {
                if (!bucket()) {
                    return;
                }

                let { cloud_sync } = bucket();
                return cloudSyncStatusMapping[cloud_sync ? cloud_sync.status : 'NOTSET'];
            }
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
