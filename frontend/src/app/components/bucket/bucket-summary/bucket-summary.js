/* Copyright (C) 2016 NooBaa */

import template from './bucket-summary.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import style from 'style';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { toBytes } from 'utils/size-utils';
import { getBucketStateIcon } from 'utils/ui-utils';
import { stringifyAmount } from 'utils/string-utils';

const cloudSyncStatusMapping = deepFreeze({
    PENDING: 'Waiting for sync',
    SYNCING: 'Syncing',
    PAUSED: 'Paused',
    UNABLE: 'Unable to Sync',
    SYNCED: 'Completed',
    NOTSET: 'Not Set'
});

const availableForWriteTooltip = `This number is calculated according to the
    bucket\'s available storage and the number of replicas defined in its placement
    policy. <br><br> Note: This number is limited by quota if set.`;

const quotaUnitMapping = deepFreeze({
    GIGABYTE: 'GB',
    TERABYTE: 'TB',
    PETABYTE: 'PB'
});

class BucketSummrayViewModel extends BaseViewModel {
    constructor({ bucketName }) {
        super();

        const bucket = ko.pureComputed(
            () => systemInfo() && systemInfo().buckets.find(
                bucket => bucket.name === ko.unwrap(bucketName)
            )
        );

        this.graphOptions = [ 'data', 'storage' ];

        this.dataReady = ko.pureComputed(
            () => !!bucket()
        );

        this.state = ko.pureComputed(
           () => bucket() ? getBucketStateIcon(bucket().mode) : {}
        );

        this.dataPlacement = ko.pureComputed(
            () => {
                if (!bucket() || !systemInfo()) {
                    return;
                }

                const tierName = bucket().tiering.tiers[0].tier;
                const { data_placement, attached_pools } = systemInfo().tiers.find(
                    tier => tier.name === tierName
                );

                return `${
                    data_placement === 'SPREAD' ? 'Spread' : 'Mirrored'
                } on ${
                    stringifyAmount('resource', attached_pools.length)
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
            () => bucket() ? bucket().storage.values : {}
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
                    () => toBytes(storage().free)
                )
            },
            {
                label: 'Used (this bucket)',
                color: style['color13'],
                value: ko.pureComputed(
                    () => toBytes(storage().used)
                )
            },
            {
                label: 'Used (other buckets)',
                color: style['color14'],
                value: ko.pureComputed(
                    () => toBytes(storage().used_other)
                )
            }
        ];

        this.dataValues = [
            {
                label: 'Total Original Size',
                value: ko.pureComputed(
                    () => toBytes(data().size)
                ),
                color: style['color7']
            },
            {
                label: 'Compressed & Deduped',
                value: ko.pureComputed(
                    () => toBytes(data().size_reduced)
                ),
                color: style['color13']
            }
        ];


        this.legend = ko.pureComputed(
            () => this.viewType() === 'storage' ?
                this.storageValues :
                this.dataValues
        );

        this.availableForWrite = ko.pureComputed(
            () => data().available_for_upload
        ).extend({
            formatSize: true
        });

        this.availableForWriteTootlip = availableForWriteTooltip;

        const stats = ko.pureComputed(
            () => bucket() ? bucket().stats : {}
        );

        this.bucketQuota = ko.pureComputed(
            () => {
                const quota = bucket() && bucket().quota;
                return quota ?
                    `Set to ${quota.size}${quotaUnitMapping[quota.unit]}` :
                    'Disabled';
            }

        );

        this.lastAccess = ko.pureComputed(
            () => Math.max(stats().last_read, stats().last_write)
        ).extend({
            formatTime: true
        });
    }
}

export default {
    viewModel: BucketSummrayViewModel,
    template: template
};
