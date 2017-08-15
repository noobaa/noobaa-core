/* Copyright (C) 2016 NooBaa */

import template from './buckets-overview.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { loadSystemUsageHistory } from 'actions';
import { openConnectAppModal } from 'action-creators';
import style from 'style';
import moment from 'moment';
import { systemInfo, systemUsageHistory } from 'model';
import { hexToRgb } from 'utils/color-utils';
import { stringifyAmount } from 'utils/string-utils';
import { toBytes, formatSize, sumSize } from 'utils/size-utils';
import { aggregateStorage, interpolateStorage } from 'utils/storage-utils';
import { deepFreeze, groupBy, isFunction } from 'utils/core-utils';
import { action$ } from 'state';

const durationOptions = deepFreeze([
    {
        label: 'Day',
        value: {
            duration: 24,
            stepSize: 4,
            stepUnit: 'hour',
            tickFormat: 'HH:mm',
            pointRadius: 1
        }
    },
    {
        label: 'Week',
        value: {
            duration: 7,
            stepSize: 1,
            stepUnit: 'day',
            tickFormat: 'D MMM',
            pointRadius: 0
        }
    },
    {
        label : 'Month',
        value: {
            duration: 30,
            stepSize: 6,
            stepUnit: 'day',
            tickFormat: 'D MMM',
            pointRadius: 0
        }
    }
]);

const chartDatasets = deepFreeze([
    {
        key: 'used',
        label: 'Used',
        labelPadding: 10,
        color: hexToRgb(style['color8']),
        fill: hexToRgb(style['color8'], .3)
    },
    {
        key: 'unavailable_free',
        label: 'Unavailable',
        labelPadding: 10,
        color: hexToRgb(style['color6']),
        fill: hexToRgb(style['color6'], .3)
    },
    {
        key: 'free',
        label: 'Free',
        labelPadding: 10,
        color: hexToRgb(style['color16']),
        fill: hexToRgb(style['color16'], .3)
    }
]);

function interpolateSamples(sample0, sample1, time) {
    const t = (time - sample0.timestamp) / (sample1.timestamp - sample0.timestamp);
    return interpolateStorage(sample0.storage, sample1.storage, t);
}

function filterSamples(samples, start, end, includeCloudStorage) {
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
        ({ timestamp, cloud, nodes }) => {
            const storage = includeCloudStorage ? aggregateStorage(nodes, cloud) : nodes;
            return { timestamp,  storage };
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

function getChartOptions(samples, start, end, stepSize, stepUnit, tickFormat) {
    const gutter = parseInt(style['gutter']);

    const useFixedMax = samples.every(
        ({ storage }) => toBytes(storage.free || 0) === 0  &&
            toBytes(storage.unavailable_free || 0) === 0 &&
            toBytes(storage.used || 0) === 0
    );

    const cluster = systemInfo().cluster;
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
            data: samples.map(
                ({ timestamp, storage }) => ({
                    x: timestamp,
                    y: toBytes(storage[key]),
                    radius: 10
                })
            )
        })
    );

    return { datasets };
}


class BucketsOverviewViewModel extends BaseViewModel {
    constructor() {
        super();

        // This cannot be declered as constant because the value need to be updated
        // to the time the component is instantize so it will not be too stale.
        this.now = Date.now();

        this.bucketCount = ko.pureComputed(
            () => {
                const count = (systemInfo() ? systemInfo().buckets : []).length;
                return stringifyAmount('Bucket', count, 'No');
            }
        );

        this.durationOptions = durationOptions;
        this.selectedDuration = ko.observable(durationOptions[0].value);
        this.includeCloudStorage = ko.observable(false);

        const currentUsage = ko.pureComputed(
            () => {
                const { HOSTS: nodes = [], CLOUD: cloud = [] } = groupBy(
                    systemInfo() ? systemInfo().pools : [],
                    pool => pool.resource_type,
                    pool => pool.storage
                );

                return {
                    timestamp: this.now,
                    nodes: aggregateStorage(...nodes),
                    cloud: aggregateStorage(...cloud)
                };
            }
        );

        this.legendItems = chartDatasets.map(
            ({ label, color, key }) => {
                const value = ko.pureComputed(
                    () => {
                        const { nodes, cloud } = currentUsage();
                        return this.includeCloudStorage() ?
                            sumSize(nodes[key] || 0, cloud[key] || 0) :
                            nodes[key] || 0;
                    }
                ).extend({
                    formatSize: true
                });

                return { color, label, value };
            }
        );

        this.chart = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return { options: {}, data: {} };
                }

                const { duration, stepSize, stepUnit, tickFormat,
                    pointRadius } = this.selectedDuration();

                const t = moment(this.now).add(1, stepUnit).startOf(stepUnit);
                const end = t.valueOf();
                const start = t.subtract(duration, stepUnit).startOf(stepUnit).valueOf();
                const samples = filterSamples(
                    (systemUsageHistory() || []).concat(currentUsage()),
                    start,
                    end,
                    this.includeCloudStorage()
                );

                return {
                    options: getChartOptions(samples, start, end, stepSize, stepUnit, tickFormat),
                    data: getChartData(samples, pointRadius)
                };
            }
        );

        loadSystemUsageHistory();
    }

    onConnectApplication () {
        action$.onNext(openConnectAppModal());
    }
}

export default {
    viewModel: BucketsOverviewViewModel,
    template: template
};
