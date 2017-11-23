/* Copyright (C) 2016 NooBaa */

import template from './bucket-summary.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { deepFreeze, sumBy } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { realizeUri } from 'utils/browser-utils';
import { isSizeZero, formatSize, toBytes } from 'utils/size-utils';
import { getDataBreakdown, getQuotaValue } from 'utils/bucket-utils';
import { timeShortFormat } from 'config';
import ko from 'knockout';
import style from 'style';
import moment from 'moment';
import { requestLocation } from 'action-creators';
import {
    getBucketStateIcon,
    getCloudSyncState,
    getPlacementTypeDisplayName
} from 'utils/bucket-utils';

const viewOptions = deepFreeze([
    {
        label: 'Availability',
        value: 'AVAILABILITY'
    },
    {
        label: 'Data Usage',
        value: 'DATA_USAGE'
    },
    {
        label: 'Raw Usage',
        value: 'RAW_USAGE'
    }
]);

const quotaUnitMapping = deepFreeze({
    GIGABYTE: 'GB',
    TERABYTE: 'TB',
    PETABYTE: 'PB'
});

class BucketSummrayViewModel extends Observer {
    constructor({ bucketName }) {
        super();

        this.pathname = '';
        this.formatSize = formatSize;
        this.viewOptions = viewOptions;
        this.bucketLoaded = ko.observable();
        this.state = ko.observable();
        this.dataPlacement = ko.observable();
        this.cloudSyncStatus = ko.observable();
        this.selectedView = ko.observable();
        this.bucketQuota = ko.observable();
        this.availablityMarkers = ko.observableArray();
        this.lastAccess = ko.observable();
        this.chartValues = ko.observableArray();
        this.legendCss = ko.observable();
        this.lastRawUsageTime = ko.observable();
        this.lastDataUsageTime = ko.observable();

        this.availablity = [
            {
                label: 'Used Data',
                color: style['color8'],
                value: ko.observable()
            },
            {
                label: 'Overused',
                color: style['color10'],
                value: ko.observable(),
                visible: ko.observable()
            },
            {
                label: 'Available',
                color: style['color5'],
                value: ko.observable()
            },
            {
                label: 'Available on spillover',
                color: style['color18'],
                value: ko.observable(),
                visible: ko.observable()
            },
            {
                label: 'Overallocated',
                color: style['color11'],
                value: ko.observable(),
                visible: ko.observable()
            }
        ];

        this.barChartData  = [
            {
                label: 'Total Original Size',
                color: style['color7'],
                parts: [
                    {
                        value: ko.observable(),
                        color: style['color7']

                    }
                ]

            },
            {
                label: 'Compressed & Deduped',
                color: style['color13'],
                parts: [
                    {
                        value: ko.observable(),
                        color: style['color13']

                    }
                ]

            }
        ];

        this.dataUsage = this.barChartData.map(({ label, color, parts }) => ({
            label,
            color: color,
            value: ko.pureComputed(() => sumBy(parts, ({ value }) => value()))
        }));

        this.rawUsage = [
            {
                label: 'Available from Resources',
                color: style['color5'],
                value: ko.observable()
            },
            {
                label: 'Available Spillover',
                color: style['color18'],
                value: ko.observable()
            },
            {
                label: 'Bucket Usage (Replicated)',
                color: style['color13'],
                value: ko.observable()
            },
            {
                label: 'Shared Usage',
                color: style['color14'],
                value: ko.observable()
            }
        ];

        this.observe(
            state$.getMany(
                ['buckets', ko.unwrap(bucketName)],
                'location'
            ),
            this.onBucket
        );
    }

    onBucket([ bucket, location ]) {
        if (!bucket) {
            this.state({});
            this.bucketLoaded(false);
            return;
        }

        const { data, storage, quota, placement } = bucket;
        const { view = this.viewOptions[0].value } = location.query;
        const { policyType, resources } = placement;

        const dataPlacement = `${
            getPlacementTypeDisplayName(policyType)
        } on ${
            stringifyAmount('resource', resources.length)
        }`;

        const cloudSync = getCloudSyncState(bucket).text;

        const quotaText = quota ?
            `Set to ${quota.size}${quotaUnitMapping[quota.unit]}` :
            'Disabled';

        const { lastRead, lastWrite } = bucket.io;
        const lastAccess = Math.max(lastRead, lastWrite);
        const lastAccessText = lastAccess > -1 ?
            moment(lastAccess).format(timeShortFormat) :
            'Never accessed';

        const availablity = getDataBreakdown(data, quota);
        const availablityMarkers = [];
        if (quota) {
            const value = getQuotaValue(quota);
            const placement = toBytes(value);
            const label = `Quota: ${formatSize(value)}`;

            availablityMarkers.push({ placement, label });
        }

        const chartValues = {
            AVAILABILITY: this.availablity,
            DATA_USAGE: this.dataUsage,
            RAW_USAGE: this.rawUsage
        }[view];

        const legendCss = view === 'AVAILABILITY' ? 'legend-row' : '';
        const lastRawUsageTime = moment(storage.lastUpdate).fromNow();
        const lastDataUsageTime = moment(data.lastUpdate).fromNow();

        this.pathname = location.pathname;
        this.state(getBucketStateIcon(bucket));
        this.dataPlacement(dataPlacement);
        this.cloudSyncStatus(cloudSync);
        this.selectedView(view);
        this.bucketQuota(quotaText);

        this.availablity[0].value(toBytes(availablity.used));
        this.availablity[1].value(toBytes(availablity.overused));
        this.availablity[1].visible(!isSizeZero(availablity.overused));
        this.availablity[2].value(toBytes(availablity.availableForUpload));
        this.availablity[3].value(toBytes(availablity.availableForSpillover));
        this.availablity[3].visible(Boolean(bucket.spillover));
        this.availablity[4].value(toBytes(availablity.overallocated));
        this.availablity[4].visible(!isSizeZero(availablity.overallocated));
        this.availablityMarkers(availablityMarkers);
        this.barChartData[0].parts[0].value(toBytes(data.size));
        this.barChartData[1].parts[0].value(toBytes(data.sizeReduced));
        this.lastRawUsageTime(lastRawUsageTime);
        this.rawUsage[0].value(toBytes(storage.free));
        this.rawUsage[1].value(toBytes(storage.spilloverFree));
        this.rawUsage[2].value(toBytes(storage.used));
        this.rawUsage[3].value(toBytes(storage.usedOther));
        this.lastDataUsageTime(lastDataUsageTime);
        this.lastAccess(lastAccessText);
        this.bucketLoaded(true);
        this.chartValues(chartValues);
        this.legendCss(legendCss);
    }

    onSelectView(view) {
        const url = realizeUri(this.pathname, {}, { view });
        action$.onNext(requestLocation(url), true);
    }
}

export default {
    viewModel: BucketSummrayViewModel,
    template: template
};
