import template from './bucket-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/all';

const stateMapping = deepFreeze({
    true: {
        text: 'Healthy',
        css: 'success',
        icon: 'healthy'
    },
    false: {
        text: 'Offline',
        css: 'error',
        icon: 'problem'
    }
});

const cloudSyncStatusMapping = deepFreeze({
    PENDING: 'Pending',
    SYNCING: 'Syncing',
    PAUSED: 'Paused',
    UNABLE: 'Unable to Sync',
    SYNCED: 'Completed',
    NOTSET: 'not set'
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

const avaliableForWriteTooltip = 'This number is calculated according to the bucket\'s available capacity and the number of replicas defined in its placement policy';

class BucketSummrayViewModel extends Disposable {
    constructor({ bucket }) {
        super();

        this.dataReady = ko.pureComputed(
            () => !!bucket()
        );

        this.state = ko.pureComputed(
            () => stateMapping[true]
        );

        this.dataPlacement = ko.pureComputed(
            () => {
                if (!bucket() || !systemInfo()) {
                    return;
                }

                let tierName = bucket().tiering.tiers[0].tier;
                let { data_placement , attached_pools } = systemInfo().tiers.find(
                    tier => tier.name === tierName
                );

                return `${
                    data_placement === 'SPREAD' ? 'Spread' : 'Mirrored'
                } on ${
                    attached_pools.length
                } pool${
                    attached_pools.length !== 1 ? 's' : ''
                }`;
            }
        );

        this.cloudSyncStatus = ko.pureComputed(
            () => {
                if (!bucket()) {
                    return;
                }

                let { cloud_sync } = bucket();
                return cloudSyncStatusMapping[
                    cloud_sync ? cloud_sync.status : 'NOTSET'
                ];
            }
        );

        this.graphOptions = graphOptions;

        this.selectedGraph = ko.observable(graphOptions[0].value);

        let storage = ko.pureComputed(
            () => bucket() ? bucket().storage : {}
        );

        let data = ko.pureComputed(
            () => bucket() ? bucket().data : {}
        );

        this.totalStorage = ko.pureComputed(
            () => storage().total
        ).extend({
            formatSize: true
        });

        this.storageValues = [
            {
                label: 'Used (this bucket)',
                color: style['color13'],
                value: ko.pureComputed(
                    () => storage().used
                )
            },
            {
                label: 'Used (other buckets)',
                color: style['color14'],
                value: ko.pureComputed(
                    () => storage().used_other
                )
            },
            {
                label: 'Potential available',
                color: style['color5'],
                value: ko.pureComputed(
                    () => storage().free
                )
            }
        ];

        this.dataValues = [
            {
                label: 'Reduced',
                value: ko.pureComputed(
                    () => data().size_reduced
                ),
                color: style['color13']
            },
            {
                label: 'Size',
                value: ko.pureComputed(
                    () => data().size
                ),
                color: style['color7']
            }
        ];


        this.legend = ko.pureComputed(
            () => this.selectedGraph() === 'STORAGE' ?
                this.storageValues :
                this.dataValues
        );

        this.avaliableForWrite = ko.pureComputed(
            () => data().actual_free
        ).extend({
            formatSize: true
        });

        this.avaliableForWriteTooltip = avaliableForWriteTooltip;

        let stats = ko.pureComputed(
            () => bucket() ? bucket().stats : {}
        );

        this.lastRead = ko.pureComputed(
            () => stats().last_read
        ).extend({
            formatTime: true
        });

        this.lastWrite = ko.pureComputed(
            () => stats().last_write
        ).extend({
            formatTime: true
        });

        this.isPolicyModalVisible = ko.observable(false);
        this.isSetCloudSyncModalVisible = ko.observable(false);
        this.isViewCloudSyncModalVisible = ko.observable(false);
    }
}

export default {
    viewModel: BucketSummrayViewModel,
    template: template
};
