/* Copyright (C) 2016 NooBaa */

import template from './bucket-summary.html';
import Observer from 'observer';
import ko from 'knockout';
import style from 'style';
import { deepFreeze } from 'utils/core-utils';
import { toBigInteger, fromBigInteger, bigInteger, toBytes, formatSize } from 'utils/size-utils';
import { formatTime } from 'utils/string-utils';
import { state$ } from 'state';

const stateMapping = deepFreeze({
    OPTIMAL: {
        text: 'Healthy',
        css: 'success',
        icon: 'healthy'
    },
    NOT_WRITABLE: {
        text: 'Not enough healthy resources',
        css: 'error',
        icon: 'problem'
    }
});

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
    GIGABYTE: { label: 'GB', inBytes: Math.pow(1024, 3) },
    TERABYTE: { label: 'TB', inBytes: Math.pow(1024, 4) },
    PETABYTE: { label: 'PB', inBytes: Math.pow(1024, 5) },
});

const graphOptions = deepFreeze([
    { value: 'available', label: 'Available' },
    { value: 'dataUsage', label: 'Data Usage' },
    { value: 'rawUsage', label: 'Raw Usage' }
]);

function quotaBigInt({ size, unit }) {
    return toBigInteger(size).multiply(quotaUnitMapping[unit].inBytes);
}

function getBarValues(values) {
    return [
        {
            value: toBytes(values.used),
            label: 'Used Data',
            color: style['color8']
        },
        {
            value: toBytes(values.overused),
            label: 'Overused',
            color: style['color10']
        },
        {
            value: toBytes(values.availableToUpload),
            label: 'Available to upload',
            color: style['color7']
        },
        {
            value: toBytes(values.availableSpillover),
            label: 'Available spillover',
            color: style['color6']
        },
        {
            value: toBytes(values.overallocated),
            label: 'Overallocated',
            color: style['color16']
        }
    ]
        .filter(item => item.value > 0);
}

function calcDataBreakdown({data, quota}) {
    const zero = bigInteger.zero;
    const spillover = toBigInteger(data.spillover_free);
    const available = toBigInteger(data.free);
    const dataSize = toBigInteger(data.size);

    let  used, overused, availableToUpload, availableSpillover, overallocated;
    if (quota) {
        const quotaSize = quotaBigInt(quota);

        used = bigInteger.min(dataSize, quotaSize);
        overused = bigInteger.max(zero, dataSize.subtract(quotaSize));
        availableToUpload = bigInteger.min(bigInteger.max(zero, quotaSize - used), available);
        availableSpillover = bigInteger.min(spillover, bigInteger.max(zero, quotaSize - used - available));
        overallocated = bigInteger.max(zero, quotaSize.subtract(used.add(available.add(spillover))));
    } else {
        used = dataSize;
        overused = zero;
        availableToUpload = available;
        availableSpillover = spillover;
        overallocated = zero;
    }

    return {
        used: fromBigInteger(used),
        overused: fromBigInteger(overused),
        availableToUpload: fromBigInteger(availableToUpload),
        availableSpillover: fromBigInteger(availableSpillover),
        overallocated: fromBigInteger(overallocated)
    };
}

class BucketSummaryViewModel extends Observer {
    constructor({ bucketName }) {
        super();

        this.graphOptions = graphOptions;
        this.dataReady = ko.observable(false);
        this.state = ko.observable();
        this.dataPlacement  = ko.observable();
        this.cloudSyncStatus = ko.observable();
        this.viewType = ko.observable(this.graphOptions[0].value);
        this.totalStorage = ko.observable();
        this.availableValues = ko.observable();
        this.rawUsageValues = ko.observable();
        this.dataUsageValues = ko.observable();
        this.availableForWrite = ko.observable();
        this.availableForWriteTootlip = availableForWriteTooltip;
        this.bucketQuota = ko.observable();
        this.lastAccess = ko.observable();

        this.legend = ko.pureComputed(
            () => this[`${this.viewType()}Values`]()
        );

        this.legendCss = ko.pureComputed(
            () => this.viewType() === 'available' ? 'legend-row' : ''
        );

        this.quotaMarkers = ko.observable([]);
        this.observe(state$.get('buckets', ko.unwrap(bucketName)), this.onBucket);
    }

    onBucket(bucket) {
        if(!bucket) return;
        const { data, stats, quota, cloudSyncStatus, mode } = bucket;
        const storage = bucket.storage.values;

        this.dataPlacement(`${
            bucket.backingResources.type === 'SPREAD' ? 'Spread' : 'Mirrored'
            } on ${
            bucket.backingResources.resources.length
            } pool${
            bucket.backingResources.resources.length !== 1 ? 's' : ''
            }`
        );

        this.totalStorage = ko.observable(formatSize(storage.total));
        this.state(stateMapping[mode]);
        this.cloudSyncStatus(cloudSyncStatusMapping[cloudSyncStatus]);

        this.rawUsageValues([
            {
                label: 'Available from resources',
                color: style['color5'],
                value: toBytes(storage.free)
            },
            {
                label: 'Available spillover',
                color: style['color6'],
                value: toBytes(storage.spillover_free)
            },
            {
                label: 'Used by bucket (with replicas)',
                color: style['color13'],
                value: toBytes(storage.used)
            },
            {
                label: 'Used (on shared resources)',
                color: style['color14'],
                value: toBytes(storage.used_other)
            }
        ]);

        this.dataUsageValues([
            {
                label: 'Total Original Size',
                value: toBytes(data.size),
                color: style['color7']
            },
            {
                label: 'Compressed & Deduped',
                value: toBytes(data.size_reduced),
                color: style['color13']
            }
        ]);

        this.availableForWrite = ko.observable(formatSize(data.available_for_upload));

        this.bucketQuota(quota ?
            `Set to ${quota.size}${quotaUnitMapping[quota.unit].label}` :
            'Disabled');

        this.availableValues(
            getBarValues(
                calcDataBreakdown(bucket)
            )
        );

        if(quota) {
            const quotaSize = quotaBigInt(quota);

            this.quotaMarkers([{
                placement: toBytes(quotaSize),
                label: `Quota: ${formatSize(fromBigInteger(quotaSize))}`
            }]);
        } else {
            this.quotaMarkers([]);
        }


        this.lastAccess(formatTime(Math.max(stats.last_read, stats.last_write)));
        this.dataReady(true);
    }

    formatBarLabel(value) {
        return value && formatSize(value);
    }
}

export default {
    viewModel: BucketSummaryViewModel,
    template: template
};
