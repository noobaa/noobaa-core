/* Copyright (C) 2016 NooBaa */

import template from './bucket-summary.html';
import Observer from 'observer';
import ko from 'knockout';
import style from 'style';
import { deepFreeze } from 'utils/core-utils';
import { toBigInteger, fromBigInteger, bigInteger, toBytes, formatSize } from 'utils/size-utils';
import { formatTime } from 'utils/string-utils';
import { routeContext } from 'model';
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
    console.warn('unit', unit);
    console.warn('size', size);
    return toBigInteger(size).multiply(quotaUnitMapping[unit].inBytes);
}

const quotaSizeValidationMessage = 'Must be a number bigger or equal to 1';

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
            value: toBytes(values.availableOverQuota),
            label: 'Potential',
            color: style['color15']
        },
        {
            value: toBytes(values.overallocated),
            label: 'Overallocated',
            color: style['color16']
        }
    ]
        .filter(item => item.value > 0);
}

function calcDataBreakdown(data, spillover, quota) {
    if (quota) {
        const zero = bigInteger.zero;
        const available = toBigInteger(data.free);
        const quotaSize = quotaBigInt(quota);
        const used = bigInteger.min(toBigInteger(data.size), quotaSize);
        const availableSpillover = toBigInteger(spillover.free);
        const overused = bigInteger.max(zero, toBigInteger(data.size).subtract(quotaSize));
        const overallocated = bigInteger.max(zero, quotaSize.subtract(available.add(used)));
        const availableToUpload = bigInteger.min(bigInteger.max(zero, quotaSize.subtract(used)), available);
        const availableOverQuota = bigInteger.max(zero, available.subtract(availableToUpload));

        return {
            used: fromBigInteger(used),
            overused: fromBigInteger(overused),
            availableToUpload: fromBigInteger(availableToUpload),
            availableSpillover: fromBigInteger(availableSpillover),
            availableOverQuota: fromBigInteger(availableOverQuota),
            overallocated: fromBigInteger(overallocated)
        };

    } else {
        return {
            used: data.size,
            overused: 0,
            availableToUpload: data.free,
            availableSpillover: spillover.free,
            availableOverQuota: 0,
            overallocated: 0
        };
    }
}

class BucketSummrayViewModel extends Observer {
    constructor() {
        super();

        this.graphOptions = graphOptions;
        this.dataReady = ko.observable(false);
        this.state = ko.observable();

        this.dataPlacement  = ko.observable();
        this.cloudSyncStatus = ko.observable();
        this.viewType = ko.observable(this.graphOptions[0].value);

        this.totalStorage = ko.observable();

        this.availableValues = [
            {
                label: 'Used data:',
                color: style['color13'],
                value: ko.observable()
            },
            {
                label: 'Available to upload:',
                color: style['color7'],
                value: ko.observable()
            },
            {
                label: 'Available spillover:',
                color: style['color6'],
                value: ko.observable(),
            }
        ];

        this.rawUsageValues = [
            {
                label: 'Available from resources',
                color: style['color5'],
                value: ko.observable()
            },
            {
                label: 'Available spillover',
                color: style['color6'],
                value: ko.observable()
            },
            {
                label: 'Used by bucket (with replicas)',
                color: style['color13'],
                value: ko.observable()
            },
            {
                label: 'Used (on shared resources)',
                color: style['color14'],
                value: ko.observable()
            }
        ];

        this.dataUsageValues = [
            {
                label: 'Total Original Size',
                value: ko.observable(),
                color: style['color7']
            },
            {
                label: 'Compressed & Deduped',
                value: ko.observable(),
                color: style['color13']
            }
        ];

        this.legend = ko.observable();
        this.availableForWrite = ko.observable();
        this.availableForWriteTootlip = availableForWriteTooltip;
        this.bucketQuota = ko.observable();
        this.lastAccess = ko.observable();

        this.legend = ko.pureComputed(
            () => this[`${this.viewType()}Values`]
        );

        this.legendCss = ko.pureComputed(
            () => this.viewType() === 'available' ? 'legend-row' : ''
        );

        this.segments = ko.observable();
        this.redraw = ko.observable();

        this.dataSize = ko.observable();
        this.dataFree = ko.observable()
        this.dataSpilloverFree = ko.observable();
        this.quotaUnit = ko.observable();
        this.quotaSize = ko.observable().extend({
            required: {
                onlyIf: this.isUsingQuota,
                message: quotaSizeValidationMessage
            },
            number: {
                onlyIf: this.isUsingQuota,
                message: quotaSizeValidationMessage
            },
            min: {
                onlyIf: this.isUsingQuota,
                params: 1,
                message: quotaSizeValidationMessage
            }
        });

        this.barValues = ko.pureComputed(
            () => getBarValues(
                calcDataBreakdown(
                    { size: this.dataSize(), free: this.dataFree() },
                    { size: this.dataSize(), free: this.dataSpilloverFree() },
                    { unit: this.quotaUnit(), size: this.quotaSize() }
                )
            )
        );

        this.quotaMarker = ko.pureComputed(
            () => {
                const quota = quotaBigInt({
                    size: this.quotaSize(),
                    unit: this.quotaUnit()
                });

                return {
                    placement: toBytes(quota),
                    label: `Quota: ${formatSize(fromBigInteger(quota))}`
                };
            }
        );

        this.observe(state$.get('buckets'), this.onState);
    }

    onState(buckets) {
        const bucketsList = Object.values(buckets);
        const bucket = bucketsList.find(
            ({ name }) => routeContext().params.bucket === name
        );
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

        this.availableValues[0].value(toBytes(data.size));
        this.availableValues[1].value(toBytes(data.available_for_upload));
        this.availableValues[2].value(toBytes(data.spillover_free));

        this.rawUsageValues[0].value(toBytes(storage.free));
        this.rawUsageValues[1].value(toBytes(storage.spillover_free));
        this.rawUsageValues[2].value(toBytes(storage.used));
        this.rawUsageValues[3].value(toBytes(storage.used_other));

        this.dataUsageValues[0].value(toBytes(data.size));
        this.dataUsageValues[1].value(toBytes(data.size_reduced));

        this.availableForWrite = ko.observable(formatSize(data.available_for_upload));

        this.bucketQuota(quota ?
            `Set to ${quota.size}${quotaUnitMapping[quota.unit].label}` :
            'Disabled');

        this.lastAccess(formatTime(Math.max(stats.last_read, stats.last_write)));

        this.dataSize(data.size);
        this.dataFree(data.free);
        this.dataSpilloverFree(data.spillover_free);
        this.quotaUnit(quota ? quota.unit : 'GIGABYTE');
        this.quotaSize(quota ? quota.size :  0);
        this.dataReady(true);
    }

    formatBarLabel(value) {
        return value && formatSize(value);
    }
}

export default {
    viewModel: BucketSummrayViewModel,
    template: template
};
