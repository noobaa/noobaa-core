/* Copyright (C) 2016 NooBaa */

// const availableForWriteTooltip = `This number is calculated according to the
//     bucket\'s available storage and the number of replicas defined in its placement
//     policy. <br><br> Note: This number is limited by quota if set.`;

const quotaUnitMapping = deepFreeze({
    GIGABYTE: 'GB',
    TERABYTE: 'TB',
    PETABYTE: 'PB'
});

import template from './bucket-summary.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { deepFreeze } from 'utils/core-utils';
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
    getPlacementTypeDisplayName,
} from 'utils/bucket-utils';

const viewOptions = deepFreeze([
    {
        label: 'Availability',
        value: 'AVAILABILITY',
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

class BucketSummrayViewModel2 extends Observer {
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
        this.totalCapacity = ko.observable();
        this.lastRawUsageTime = ko.observable();
        this.lastDataUsageTime = ko.observable();

        this.availablity = [
            {
                key: 'used',
                label: 'Used Data',
                color: style['color8'],
                value: ko.observable()
            },
            {
                key: 'overused',
                label: 'Overused',
                color: style['color10'],
                value: ko.observable(),
                visible: ko.observable()
            },
            {
                key: 'availableForUpload',
                label: 'Available',
                color: style['color7'],
                value: ko.observable()
            },
            {
                key: 'availableForSpillover',
                label: 'Available for spillover',
                color: style['color6'],
                value: ko.observable(),
                visible: ko.observable()
            },
            {
                key: 'overallocated',
                label: 'Overallocated',
                color: style['color11'],
                value: ko.observable(),
                visible: ko.observable()
            }
        ];

        this.dataUsage = [
            {
                label: 'Total Original Size',
                color: style['color7'],
                value: ko.observable(),
            },
            {
                label: 'Compressed & Deduped',
                color: style['color13'],
                value: ko.observable()
            }
        ];

        this.rawUsage = [
            {
                label: 'Available from Resources',
                color: style['color5'],
                value: ko.observable()
            },
            {
                label: 'Available Spillover',
                color: style['color6'],
                value: ko.observable()
            },
            {
                label: 'Bucket Usage (Replicated)',
                color: style['color13'],
                value: ko.observable()
            },
            {
                label: 'Shared Used',
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

        const breakdown = getDataBreakdown(data, quota);
        this.availablity.forEach(part => {
            const value = breakdown[part.key];
            part.value(toBytes(value));
            part.visible && part.visible(!isSizeZero(value));
        });

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
        this.availablityMarkers(availablityMarkers);
        this.dataUsage[0].value(data.size);
        this.dataUsage[1].value(data.sizeReduced);
        this.lastRawUsageTime(lastRawUsageTime);
        this.rawUsage[0].value(storage.free);
        this.rawUsage[1].value(storage.spilloverFree);
        this.rawUsage[2].value(storage.used);
        this.rawUsage[3].value(storage.usedOther);
        this.lastDataUsageTime(lastDataUsageTime);
        this.totalCapacity(formatSize(storage.total));
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

// class BucketSummrayViewModel extends BaseViewModel {
//     constructor({ bucketName }) {
//         super();


//         this.totalStorage = ko.pureComputed(
//             () => storage().total
//         ).extend({
//             formatSize: true
//         });

//         this.storageValues = [
//             {
//                 label: 'Available',
//                 color: style['color5'],
//                 value: ko.pureComputed(
//                     () => toBytes(storage().free)
//                 )
//             },
//             {
//                 label: 'Used (this bucket)',
//                 color: style['color13'],
//                 value: ko.pureComputed(
//                     () => toBytes(storage().used)
//                 )
//             },
//             {
//                 label: 'Used (other buckets)',
//                 color: style['color14'],
//                 value: ko.pureComputed(
//                     () => toBytes(storage().used_other)
//                 )
//             }
//         ];

//         this.dataValues = [
//             {
//                 label: 'Total Original Size',
//                 value: ko.pureComputed(
//                     () => toBytes(data().size)
//                 ),
//                 color: style['color7']
//             },
//             {
//                 label: 'Compressed & Deduped',
//                 value: ko.pureComputed(
//                     () => toBytes(data().size_reduced)
//                 ),
//                 color: style['color13']
//             }
//         ];


//         this.legend = ko.pureComputed(
//             () => this.viewType() === 'storage' ?
//                 this.storageValues :
//                 this.dataValues
//         );

//         this.availableForWrite = ko.pureComputed(
//             () => data().available_for_upload
//         ).extend({
//             formatSize: true
//         });

//         this.availableForWriteTootlip = availableForWriteTooltip;


//     }
// }

export default {
    viewModel: BucketSummrayViewModel2,
    template: template
};
