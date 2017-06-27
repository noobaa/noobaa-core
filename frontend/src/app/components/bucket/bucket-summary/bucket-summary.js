/* Copyright (C) 2016 NooBaa */

import template from './bucket-summary.html';
import Observer from 'observer';
import ko from 'knockout';
import style from 'style';
import { deepFreeze } from 'utils/core-utils';
import { toBytes, formatSize } from 'utils/size-utils';
import { formatTime } from 'utils/string-utils';
import { drawLine } from 'utils/canvas-utils';
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
    GIGABYTE: 'GB',
    TERABYTE: 'TB',
    PETABYTE: 'PB'
});

const graphOptions = deepFreeze([
    { value: 'available', label: 'Available' },
    { value: 'dataUsage', label: 'Data Usage' },
    { value: 'rawUsage', label: 'Raw Usage'}
]);

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

        this.segments = ko.observable();
        this.redraw = ko.observable();

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
        this.availableValues[2].value(toBytes(storage.spillover_free));

        this.rawUsageValues[0].value(toBytes(storage.free));
        this.rawUsageValues[1].value(toBytes(storage.spillover_free));
        this.rawUsageValues[2].value(toBytes(storage.used));
        this.rawUsageValues[3].value(toBytes(storage.used_other));
        this.dataUsageValues[0].value(toBytes(data.size));
        this.dataUsageValues[1].value(toBytes(data.size_reduced));

        this.availableForWrite = ko.observable(formatSize(data.available_for_upload));

        this.bucketQuota(quota ?
            `Set to ${quota.size}${quotaUnitMapping[quota.unit]}` :
            'Disabled');

        this.lastAccess(formatTime(Math.max(stats.last_read, stats.last_write)));
        this.dataReady(true);
    }

    drawChart(ctx, { width }) {
        // Create a dependency on redraw allowing us to redraw every time,
        // the value of redraw changed.
        this.redraw();

        const baseLine = 20;
        const vpad = 4;
        const pointRadius = 5;
        const lineWidth = width - vpad * 2;
        const minSegmentSize = 10;

        const usedDataSize = this.availableValues[0].value();
        const availableSize = this.availableValues[1].value();
        const spilloverSize = this.availableValues[2].value();
        const totalSize = usedDataSize + availableSize + spilloverSize;

        let usedDataSegmentWidth = lineWidth * (usedDataSize/totalSize);
        let availableSegmentWidth = lineWidth * (availableSize/totalSize);
        let spilloverSegmentWidth = lineWidth * (spilloverSize/totalSize);

        // min segment size correction
        if(minSegmentSize > usedDataSegmentWidth) {
            usedDataSegmentWidth = minSegmentSize;
            availableSegmentWidth = lineWidth - minSegmentSize - spilloverSegmentWidth;
        }

        if(minSegmentSize > availableSegmentWidth) {
            availableSegmentWidth = minSegmentSize;
        }

        if(minSegmentSize > spilloverSegmentWidth) {
            spilloverSegmentWidth = minSegmentSize;
            availableSegmentWidth = lineWidth - minSegmentSize - usedDataSegmentWidth;
        }

        ctx.strokeStyle = this.availableValues[0].color;
        drawLine(ctx, vpad , baseLine, usedDataSegmentWidth, baseLine);
        ctx.strokeStyle = this.availableValues[1].color;
        drawLine(ctx, usedDataSegmentWidth, baseLine, usedDataSegmentWidth + availableSegmentWidth, baseLine);
        ctx.strokeStyle = this.availableValues[2].color;
        drawLine(ctx, usedDataSegmentWidth + availableSegmentWidth, baseLine, lineWidth, baseLine);

        ctx.fillStyle = style['color7'];
        ctx.font = `12px ${style['font-family1']}`;
        ctx.textAlign = 'center';
        ctx.fillText('0', vpad, 12);
        drawLine(ctx, vpad , baseLine + pointRadius, vpad, baseLine - pointRadius);
        drawLine(ctx, usedDataSegmentWidth , baseLine + pointRadius, usedDataSegmentWidth, baseLine - pointRadius);
        drawLine(ctx, usedDataSegmentWidth + availableSegmentWidth , baseLine + pointRadius, usedDataSegmentWidth + availableSegmentWidth, baseLine - pointRadius);
        drawLine(ctx, lineWidth , baseLine + pointRadius, lineWidth, baseLine -pointRadius);
    }

    triggerRedraw() {
        this.redraw.toggle();
    }
}

export default {
    viewModel: BucketSummrayViewModel,
    template: template
};
