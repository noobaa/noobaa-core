/* Copyright (C) 2016 NooBaa */

import template from './buckets-overview.html';
import Observer from 'observer';
import ko from 'knockout';
import style from 'style';
import moment from 'moment';
import { hexToRgb } from 'utils/color-utils';
import { stringifyAmount } from 'utils/string-utils';
import { toBytes, formatSize, toBigInteger, fromBigInteger } from 'utils/size-utils';
import { aggregateStorage, interpolateStorage } from 'utils/storage-utils';
import { deepFreeze, mapValues } from 'utils/core-utils';
import { fetchResourceStorageHistory } from 'action-creators';
import { state$, action$ } from 'state';
import bigInteger from 'big-integer';

const durationSettings = deepFreeze({
    DAY: {
        duration: 24,
        stepSize: 4,
        stepUnit: 'hour',
        tickFormat: 'HH:mm',
        pointRadius: 1,
        label: 'Day'
    },
    WEEK: {
        duration: 7,
        stepSize: 1,
        stepUnit: 'day',
        tickFormat: 'D MMM',
        pointRadius: 0,
        label: 'Week'

    },
    MONTH: {
        duration: 30,
        stepSize: 6,
        stepUnit: 'day',
        tickFormat: 'D MMM',
        pointRadius: 0,
        label: 'Month'
    }
});

const chartDatasets = deepFreeze([
    {
        key: 'internal',
        label: 'Used on internal',
        labelPadding: 10,
        color: style['color16'],
        fill: style['color16']
    },
    {
        key: 'cloud',
        label: 'Used on cloud',
        labelPadding: 10,
        color: style['color6'],
        fill: style['color6']
    },
    {
        key: 'pools',
        label: 'Used on nodes',
        labelPadding: 10,
        color: style['color8'],
        fill: style['color8']
    }
]);

function prepareChartLegendValue(resources) {
    const resourcesList = Object.values(resources);
    const storageList = resourcesList.map(item => item.storage);
    const storage = aggregateStorage(...storageList);

    return formatSize(storage.used);
}

function aggregateUsed(samplesList) {
    return fromBigInteger(samplesList.reduce(
        (sum, sample) => sum.add(toBigInteger(sample.used)),
        bigInteger.zero
    ));
}

function selectSamples(resources, storageHistory, now) {
    const resourcesList = Object.values(resources);
    const storageList = resourcesList.map(item => item.storage);
    const aggregatedStorageHistory = storageHistory.map(
        ({timestamp, samples}) => ({
            timestamp,
            used: aggregateUsed(Object.values(samples))
        })
    );

    const currentSample = {
        timestamp: now,
        used: aggregateUsed(storageList)
    };

    return [
        ...aggregatedStorageHistory,
        currentSample
    ];
}

function interpolateSamples(sample0, sample1, time) {
    const t = (time - sample0.timestamp) / (sample1.timestamp - sample0.timestamp);
    return interpolateStorage(sample0.used, sample1.used, t);
}

function filterSamples(samples, start, end) {
    const sorted = samples.sort(
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

    const [ first, second ] = filtered;
    if (first && second && first.timestamp < start) {
        filtered[0] = {
            timestamp: start,
            storage: interpolateSamples(first, second, start)
        };
    }

    const [ secondToLast, last ] = filtered.slice(-2);
    if (secondToLast && last && end < last.timestamp) {
        filtered[filtered.length - 1] = {
            timestamp: end,
            storage: interpolateSamples(secondToLast, last, end)
        };
    }

    return filtered;
}

function getChartOptions(samples, start, end, stepSize, stepUnit, tickFormat, timezone) {
    const gutter = parseInt(style['gutter']);
    const useFixedMax = [samples.pools, samples.cloud, samples.internal].every(
        samples => samples.every(
            ({ used }) => toBytes(used || 0) === 0
        )
    );
    const tickFormatter = t => moment.tz(t, timezone).format(tickFormat);

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
                ({ timestamp, used }) => ({
                    x: timestamp,
                    y: toBytes(used || 0),
                    radius: 10
                })
            )
        })
    );

    return { datasets };
}


class BucketsOverviewViewModel extends Observer {
    constructor({ selectedDuration, onDuration }) {
        super();

        this.onDuration = onDuration;
        this.now = Date.now();
        this.bucketCount = ko.observable();
        this.selectedDuration = selectedDuration;
        this.durationOptions = Object.entries(durationSettings)
            .map(([key, value]) => ({
                value: key,
                label: value.label
            }));
        this.legendItems = chartDatasets.map(
            ({ label, color, key }) => {
                const value = ko.observable();
                return { color, label, value, key };
            }
        );

        this.chart = {
            options: ko.observable(),
            data: ko.observable()
        };

        this.isConnectApplicationWizardVisible = ko.observable(false);

        this.observe(
            state$.getMany(
                'nodePools',
                'cloudResources',
                'internalResources',
                'buckets',
                ['topology', 'servers']
            ),
            this.onState
        );
        action$.onNext(fetchResourceStorageHistory());
    }

    onState([nodePools, cloudResources, internalResources, buckets, servers]) {
        const serverList = Object.values(servers);
        // check if servers already loaded
        if(!serverList.length) return;

        const timezone = serverList.find(server => server.isMaster).timezone;
        const {
            duration,
            stepSize,
            stepUnit,
            tickFormat,
            pointRadius
        } = durationSettings[this.selectedDuration];
        const now = moment.tz(this.now, timezone).toDate().getTime();
        const t = moment(this.now).add(1, stepUnit).startOf(stepUnit);
        const end = t.valueOf();
        const start = t.subtract(duration, stepUnit).startOf(stepUnit).valueOf();

        // prepare chart legends
        this.legendItems[0].value(prepareChartLegendValue(internalResources.resources));
        this.legendItems[1].value(prepareChartLegendValue(cloudResources.resources));
        this.legendItems[2].value(prepareChartLegendValue(nodePools.pools));

        const samples = mapValues(
            {
                pools: nodePools,
                cloud: cloudResources,
                internal: internalResources
            },
            (group, key) => {
                const resources = key === 'pools' ? group.pools : group.resources;
                const selected = selectSamples(resources, group.storageHistory, now);
                return filterSamples(selected, start, end);
            }
        );

        this.chart.options(getChartOptions(samples, start, end, stepSize, stepUnit, tickFormat, timezone));
        this.chart.data(getChartData(samples, pointRadius));

        const bucketCount = Object.values(buckets).length;
        
        this.bucketCount(stringifyAmount('Bucket', bucketCount, 'No'));
    }

    showConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(true);
    }

    hideConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(false);
    }

    durationSelectorToggle() {
        return ko.pureComputed({
            read: () => this.selectedDuration,
            write: val => this.onDuration(val)
        });
    }
}

export default {
    viewModel: BucketsOverviewViewModel,
    template: template
};
