/* Copyright (C) 2016 NooBaa */

import template from './buckets-overview.html';
import Observer from 'observer';
import ko from 'knockout';
import style from 'style';
import moment from 'moment';
import { routeContext } from 'model';
import { redirectTo } from 'actions';
import { hexToRgb } from 'utils/color-utils';
import { stringifyAmount } from 'utils/string-utils';
import { toBytes, formatSize } from 'utils/size-utils';
import { aggregateStorage, interpolateStorage } from 'utils/storage-utils';
import { deepFreeze, isFunction } from 'utils/core-utils';
import { fetchResourceStorageHistory } from 'dispatchers';
import { state$ } from 'state';


const durationOptions = deepFreeze([
    {
        label: 'Day',
        value: 'day'
    },
    {
        label: 'Week',
        value: 'week'
    },
    {
        label: 'Month',
        value: 'month'
    }
]);

const durationSettings = deepFreeze({
    day: {

        duration: 24,
        stepSize: 4,
        stepUnit: 'hour',
        tickFormat: 'HH:mm',
        pointRadius: 1
    },
    week: {

        duration: 7,
        stepSize: 1,
        stepUnit: 'day',
        tickFormat: 'D MMM',
        pointRadius: 0

    },
    month: {
        duration: 30,
        stepSize: 6,
        stepUnit: 'day',
        tickFormat: 'D MMM',
        pointRadius: 0
    }
});

const chartDatasets = deepFreeze([
    {
        key: 'pools',
        label: 'Used on nodes',
        labelPadding: 10,
        color: hexToRgb(style['color8']),
        fill: hexToRgb(style['color8'], .3)
    },
    {
        key: 'cloud',
        label: 'Used on cloud',
        labelPadding: 10,
        color: hexToRgb(style['color6']),
        fill: hexToRgb(style['color6'], .3)
    },
    {
        key: 'internal',
        label: 'Used on internal',
        labelPadding: 10,
        color: hexToRgb(style['color16']),
        fill: hexToRgb(style['color16'], .3)
    }
]);

function prepareStoreData(storageHistory, resources, usageHistory, legendValue) {
    const now = Date.now();
    const resourcesList = Object.values(resources);
    const storageList = resourcesList.map(item => item.storage);
    const currentStorage = aggregateStorage(...storageList);

    usageHistory([ ...storageHistory, {
        timestamp: now,
        storages: storageList
    }]);
    legendValue(formatSize(currentStorage.used || 0));
}

function interpolateSamples(sample0, sample1, time) {
    const t = (time - sample0.timestamp) / (sample1.timestamp - sample0.timestamp);
    return interpolateStorage(sample0.storage, sample1.storage, t);
}

function filterSamples(samples, start, end) {
    // We clone the array before sorting because Array.sort changes the
    // array and will not work if the array is immutable.
    const sorted = Array.from(samples).sort(
        (a, b) => a.timestamp - b.timestamp
    );

    const filtered = [];
    for (const sample of sorted) {
        if (sample.timestamp <= start) {
            filtered[0] = sample;
        } else {
            filtered.push(sample);
            if (sample.timestamp >= end) break;
        }
    }

    const aggregated = filtered.map(
        ({ timestamp, storages }) => {
            const storage = aggregateStorage(...storages);
            if(!storage.used) {
                storage.used = 0;
            }
            return { timestamp, storage };
        }
    );

    const [ first, second ] = aggregated;
    if (first && second && first.timestamp < start) {
        aggregated[0] = {
            timestamp: start,
            storage: interpolateSamples(first, second, start)
        };
    }

    const [ secondToLast, last ] = aggregated.slice(-2);
    if (secondToLast && last && end < last.timestamp) {
        aggregated[aggregated.length - 1] = {
            timestamp: end,
            storage: interpolateSamples(secondToLast, last, end)
        };
    }

    return aggregated;
}

function getChartOptions(samples, start, end, stepSize, stepUnit, tickFormat, cluster) {
    const gutter = parseInt(style['gutter']);

    const useFixedMax = samples.pools.every(
        ({ storage }) => toBytes(toBytes(storage.used || 0) === 0)
    );

    const { timezone } = cluster.shards[0].servers.find(
        ({ secret }) => secret === cluster.master_secret
    );

    const formatFunc = isFunction(tickFormat) ? tickFormat : () => tickFormat;
    const tickFormatter = t => moment.tz(t, timezone).format(formatFunc(t).toString());

    return {
        responsive: true,
        padding: 0,
        maintainAspectRatio: false,
        legend: {
            display: false
        },
        scales: {
            xAxes: [
                {
                    type: 'linear',
                    position: 'bottom',
                    gridLines: {
                        color: style['color15']
                    },
                    ticks: {
                        callback: tickFormatter,
                        maxTicksLimit: 10000,
                        min: start,
                        max: end,
                        stepSize: moment.duration(stepSize, stepUnit).asMilliseconds(),
                        fontColor: style['color7'],
                        fontFamily: style['font-family1'],
                        fontSize: 8,
                        maxRotation: 0
                    }
                }
            ],
            yAxes: [
                {
                    stacked: true,
                    gridLines: {
                        color: style['color15']
                    },
                    ticks: {
                        callback: size => size > 0 ? formatSize(Math.floor(size)) : '0',
                        fontColor: style['color7'],
                        fontFamily: style['font-family1'],
                        fontSize: 8,
                        maxRotation: 0,
                        min: 0,
                        max: useFixedMax ? Math.pow(1024, 2) : undefined,
                        stepSize: useFixedMax ? Math.pow(1024, 2) / 10 : undefined
                    }
                }
            ]
        },
        tooltips: {
            mode: 'index',
            position: 'nearest',
            backgroundColor: hexToRgb(style['color4'], .85),
            multiKeyBackground: 'transparent',
            caretSize: 7,
            cornerRadius: gutter / 4,
            xPadding: gutter / 2,
            yPadding: gutter / 2,
            titleFontFamily: style['font-family1'],
            titleFonrStyle: 'normal',
            titleFontColor: style['color6'],
            titleFontSize: parseInt(style['font-size2']),
            titleMarginBottom: gutter / 2,
            bodyFontFamily: style['font-family1'],
            bodyFontColor: style['color7'],
            bodyFontSize: parseInt(style['font-size1']),
            bodySpacing: gutter / 2,
            callbacks: {
                title: items => moment.tz(items[0].xLabel, timezone).format('D MMM HH:mm'),
                label: item => {
                    const { label } = chartDatasets[item.datasetIndex];
                    const value = formatSize(item.yLabel);
                    return `  ${label}  ${value}`;
                },
                labelColor: item => ({
                    backgroundColor: chartDatasets[item.datasetIndex].color,
                    borderColor: 'transparent'
                })
            }
        }
    };
}

function getChartData(samples, pointRadius) {
    const datasets = chartDatasets.map(
        ({ key, color, fill }) => ({
            lineTension: 0,
            borderWidth: 1,
            borderColor: color,
            backgroundColor: fill,
            pointRadius: pointRadius,
            pointHitRadius: 10,
            data: samples[key].map(
                ({ timestamp, storage }) => ({
                    x: timestamp,
                    y: toBytes(storage.used || 0),
                    radius: 10
                })
            )
        })
    );

    return { datasets };
}


class BucketsOverviewViewModel extends Observer {
    constructor() {
        super();

        const query = ko.pureComputed(
            () => routeContext().query || {}
        );

        this.selectedDuration = ko.pureComputed({
            read: () => query().duration || durationOptions[0].value,
            write: value => this.selectDuration(value)
        });

        this.bucketsCount = ko.observable();

        this.durationOptions = durationOptions;
        this.poolsUsageHistory = ko.observable([]);
        this.cloudUsageHistory = ko.observable([]);
        this.internalUsageHistory = ko.observable([]);

        this.legendItems = chartDatasets.map(
            ({ label, color, key }) => {
                const value = ko.observable();
                return { color, label, value, key };
            }
        );

        this.chart = ko.observable({ options: {}, data: {} });

        this.isConnectApplicationWizardVisible = ko.observable(false);

        fetchResourceStorageHistory();
        this.observe(state$.getMany('nodePools', 'cloudResources', 'internalResources', 'buckets', 'cluster'), this.onLoad);
    }

    onLoad([nodePools, cloudResources, internalResources, buckets, cluster]) {
        prepareStoreData(nodePools.storageHistory, nodePools.pools, this.poolsUsageHistory, this.legendItems[0].value);
        prepareStoreData(cloudResources.storageHistory, cloudResources.resources, this.cloudUsageHistory, this.legendItems[1].value);
        prepareStoreData(internalResources.storageHistory, internalResources.resources, this.internalUsageHistory, this.legendItems[2].value);
        const bucketsList = Object.values(buckets);

        this.bucketsCount(stringifyAmount('Bucket', bucketsList.length, 'No'));
        const { duration, stepSize, stepUnit, tickFormat,
            pointRadius } = durationSettings[this.selectedDuration()];

        const t = moment(Date.now()).add(1, stepUnit).startOf(stepUnit);
        const end = t.valueOf();
        const start = t.subtract(duration, stepUnit).startOf(stepUnit).valueOf();
        const pools = filterSamples(
            this.poolsUsageHistory(),
            start,
            end
        );

        const cloud = filterSamples(
            this.cloudUsageHistory(),
            start,
            end
        );

        const internal = filterSamples(
            this.internalUsageHistory(),
            start,
            end
        );

        const samples = { pools, cloud, internal };

        console.warn('cluster', cluster);


        if(cluster.master_secret) {
            this.chart({
                options: getChartOptions(samples, start, end, stepSize, stepUnit, tickFormat, cluster),
                data: getChartData(samples, pointRadius)
            });
        }
    }

    showConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(true);
    }

    hideConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(false);
    }

    selectDuration(option) {
        const duration = option || undefined;
        const filter = undefined;
        redirectTo(undefined, undefined, { filter, ...routeContext().query, duration });
    }
}

export default {
    viewModel: BucketsOverviewViewModel,
    template: template
};
