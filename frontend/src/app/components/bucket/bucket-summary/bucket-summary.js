/* Copyright (C) 2016 NooBaa */

import template from './bucket-summary.html';
import chartTooltipTemplate from './chart-tooltip.html';
import Observer from 'observer';
import BarViewModel from './bar';
import { state$ } from 'state';
import { stringifyAmount } from 'utils/string-utils';
import { isSizeZero, formatSize, toBytes } from 'utils/size-utils';
import { getDataBreakdown, getQuotaValue } from 'utils/bucket-utils';
import ko from 'knockout';
import style from 'style';
import moment from 'moment';
import numeral from 'numeral';
import { deepFreeze, flatMap, mapValues } from 'utils/core-utils';
import { getBucketStateIcon, getPlacementTypeDisplayName } from 'utils/bucket-utils';

const rawUsageTooltip = deepFreeze({
    text: 'Row usage refers to the actual size this bucket is utilizing from it\'s resources including data resiliency replicas or fragments',
    align: 'end'
});

const dataUsageTooltip = deepFreeze({
    text: 'Data optimization consist of duplication and compression',
    align: 'end'
});

function _getDataPlacementText(placement) {
    const { policyType, mirrorSets } = placement;
    const resources = flatMap(mirrorSets, ms => ms.resources);
    return `${
        getPlacementTypeDisplayName(policyType)
    } on ${
        stringifyAmount('resource', resources.length)
    }`;
}

function _getQuotaMarkers(quota) {
    if (!quota) return [];

    const value = getQuotaValue(quota);
    const placement = toBytes(value);
    const label = `Quota: ${formatSize(value)}`;
    return [{ placement, label }];
}

class BucketSummrayViewModel extends Observer {
    formatSize = formatSize;
    bucketLoaded = ko.observable();
    state = ko.observable();
    dataPlacement = ko.observable();

    availablityMarkers = ko.observableArray();
    availablityTime = ko.observable();
    availablity = [
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
            color: style['color15'],
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

    dataOptimization = ko.observable();
    dataUsage = [
        {
            label: 'Original Data Size',
            color: style['color7'],
            value: ko.observable()
        },
        {
            label: 'After Optimizations',
            color: style['color13'],
            value: ko.observable()
        }
    ];
    dataUsageTooltip = dataUsageTooltip;
    dataUsageChartTooltip = {
        maxWidth: 280,
        template: chartTooltipTemplate,
        text: {
            updateTime: ko.observable(),
            values: this.dataUsage
        }
    };

    rawUsageTotal = ko.observable();
    rawUsage = [
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
            label: 'Bucket Usage with Resiliency',
            color: style['color13'],
            value: ko.observable()
        },
        {
            label: 'Shared Usage',
            color: style['color14'],
            value: ko.observable()
        }
    ];
    rawUsageTooltip = rawUsageTooltip;
    rawUsageChartTooltip = {
        maxWidth: 280,
        template: chartTooltipTemplate,
        text: {
            caption: ko.observable(),
            updateTime: ko.observable(),
            values: this.rawUsage
        }
    };

    barChart = {
        width: 60,
        height: 60,
        draw: this.onDrawBars.bind(this),
        disabled: ko.observable(),
        bars: this.dataUsage
            .map(item => new BarViewModel(item.color))
    };

    constructor({ bucketName }) {
        super();

        this.observe(
            state$.get('buckets', ko.unwrap(bucketName)),
            this.onState
        );
    }

    onState(bucket) {
        if (!bucket) {
            this.state({});
            this.bucketLoaded(false);
            return;
        }

        const { quota, placement } = bucket;
        const storage = mapValues(bucket.storage, toBytes);
        const data = mapValues(bucket.data, toBytes);
        const availablity = mapValues(getDataBreakdown(data, quota), toBytes);
        const rawUsageTotal = formatSize(storage.total);
        const dataLastUpdateTime = moment(storage.lastUpdate).fromNow();
        const storageLastUpdateTime = moment(data.lastUpdate).fromNow();
        const hasSize = data.size > 0;
        const reducedRatio = hasSize ? data.sizeReduced / data.size : 0;
        const dataOptimization = hasSize ? numeral(1 - reducedRatio).format('%') : 'No Data';

        this.state(getBucketStateIcon(bucket));
        this.dataPlacement(_getDataPlacementText(placement));

        this.availablity[0].value(availablity.used);
        this.availablity[1].value(availablity.overused);
        this.availablity[1].visible(!isSizeZero(availablity.overused));
        this.availablity[2].value(availablity.availableForUpload);
        this.availablity[3].value(availablity.availableForSpillover);
        this.availablity[3].visible(Boolean(bucket.spillover));
        this.availablity[4].value(availablity.overallocated);
        this.availablity[4].visible(!isSizeZero(availablity.overallocated));
        this.availablityMarkers(_getQuotaMarkers(quota));
        this.availablityTime(dataLastUpdateTime);

        this.dataOptimization(dataOptimization);
        this.dataUsage[0].value(data.size);
        this.dataUsage[1].value(data.sizeReduced);
        this.dataUsageChartTooltip.text.updateTime(dataLastUpdateTime);

        this.rawUsage[0].value(storage.free);
        this.rawUsage[1].value(storage.spilloverFree);
        this.rawUsage[2].value(storage.used);
        this.rawUsage[3].value(storage.usedOther);
        this.rawUsageChartTooltip.text.caption(`Total Raw Storage: ${rawUsageTotal}`);
        this.rawUsageChartTooltip.text.updateTime(storageLastUpdateTime);
        this.rawUsageTotal(rawUsageTotal);

        this.barChart.disabled(!hasSize);
        this.barChart.bars[0].onState(1, hasSize);
        this.barChart.bars[1].onState(hasSize ? reducedRatio : 1, hasSize);

        this.bucketLoaded(true);
    }

    onDrawBars(ctx, size) {
        if (!this.bucketLoaded()) return;

        const barWidth = 16;
        const { width, height: scale } = size;
        const { bars } = this.barChart;
        const spacing = (width - bars.length * barWidth) / (bars.length + 1);

        bars.reduce(
            (offset, bar) => {
                const { color, height } = bar;
                ctx.fillStyle = color;
                ctx.fillRect(offset, (1 - height()) * scale, barWidth, height() * scale);
                return offset + barWidth + spacing;
            },
            spacing
        );
    }
}

export default {
    viewModel: BucketSummrayViewModel,
    template: template
};
