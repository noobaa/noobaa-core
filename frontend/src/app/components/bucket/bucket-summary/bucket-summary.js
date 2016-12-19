import template from './bucket-summary.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';

const stateMapping = deepFreeze({
    true: {
        text: 'Healthy',
        css: 'success',
        icon: 'healthy'
    },
    false: {
        text: 'Not enough healthy resources',
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

const avaliableForWriteTooltip = 'This number is calculated according to the bucket\'s available capacity and the number of replicas defined in its placement policy';

class BucketSummrayViewModel extends Disposable {
    constructor({ bucket }) {
        super();

        this.graphOptions = [ 'data', 'storage' ];

        this.dataReady = ko.pureComputed(
            () => !!bucket()
        );

        this.state = ko.pureComputed(
            () => stateMapping[
                Boolean(bucket() && bucket().writable)
            ]
        );

        this.dataPlacement = ko.pureComputed(
            () => {
                if (!bucket() || !systemInfo()) {
                    return;
                }

                const tierName = bucket().tiering.tiers[0].tier;
                const { data_placement , attached_pools } = systemInfo().tiers.find(
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

                const { cloud_sync } = bucket();
                return cloudSyncStatusMapping[
                    cloud_sync ? cloud_sync.status : 'NOTSET'
                ];
            }
        );

        this.viewType = ko.observable(this.graphOptions[0]);

        const storage = ko.pureComputed(
            () => bucket() ? bucket().storage : {}
        );

        const data = ko.pureComputed(
            () => bucket() ? bucket().data : {}
        );

        this.totalStorage = ko.pureComputed(
            () => storage().total
        ).extend({
            formatSize: true
        });

        this.storageValues = [
            {
                label: 'Available',
                color: style['color5'],
                value: ko.pureComputed(
                    () => storage().free
                )
            },
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
            }
        ];

        this.dataValues = [
            {
                label: 'Total Original Size',
                value: ko.pureComputed(
                    () => data().size
                ),
                color: style['color7']
            },
            {
                label: 'Compressed & Deduped',
                value: ko.pureComputed(
                    () => data().size_reduced
                ),
                color: style['color13']
            }
        ];


        this.legend = ko.pureComputed(
            () => this.viewType() === 'storage' ?
                this.storageValues :
                this.dataValues
        );

        this.avaliableForWrite = ko.pureComputed(
            () => data().actual_free
        ).extend({
            formatSize: true
        });

        this.avaliableForWriteTooltip = avaliableForWriteTooltip;

        const stats = ko.pureComputed(
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
