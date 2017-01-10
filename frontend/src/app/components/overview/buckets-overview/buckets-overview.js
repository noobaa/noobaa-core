import template from './buckets-overview.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { systemInfo, systemUsageHistory } from 'model';
import { deepFreeze, assignWith, keyBy, interpolateLinear } from 'utils/core-utils';
import { hexToRgb } from 'utils/color-utils';
import { stringifyAmount } from 'utils/string-utils';
import { sumSize, toBytes, formatSize } from 'utils/size-utils';
import style from 'style';
import moment from 'moment';
import { loadSystemUsageHistory } from 'actions';

const durationOptions = deepFreeze([
    {
        label: 'Last Week',
        value: {
            duration: 7,
            stepSize: 1
        }
    },
    {
        label : 'Last Month',
        value: {
            duration: 30,
            stepSize: 6
        }
    }
]);

const chartDatasets = deepFreeze([
    {
        key: 'used',
        label: 'Used',
        labelPadding: 10,
        color: hexToRgb(style['color8'], .4),
        fill: hexToRgb(style['color8'], .3)
    },
    {
        key: 'unavailable_free',
        label: 'Unavailable',
        labelPadding: 10,
        color: hexToRgb(style['color6'], .4),
        fill: hexToRgb(style['color6'], .3)
    },
    {
        key: 'free',
        label: 'Free',
        labelPadding: 10,
        color: hexToRgb(style['color16'], .4),
        fill: hexToRgb(style['color16'], .3)
    }
]);

function interpolateSamples(sample0, sample1, time) {
    const dt = (time - sample0.timestamp) / (sample1.timestamp - sample0.timestamp);
    return keyBy(
        chartDatasets,
        ({ key }) => key,
        ({ key }) => interpolateLinear(sample0.storage[key], sample1.storage[key], dt)
    );
}

function filterSamples(samples, start, end) {
    const sorted = Array.from(samples).sort(
        (p1, p2) => p1.timestamp - p2.timestamp
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

class BucketsOverviewViewModel extends BaseViewModel {
    constructor() {
        super();

        // These cannot be declered as constants because they need to update
        // every time the component is instantize so they will not be too stale.
        this.now = Date.now();
        this.endOfDay = moment(this.now).add(1, 'day').startOf('day').valueOf();

        this.bucketCount = ko.pureComputed(
            () => {
                const count = (systemInfo() ? systemInfo().buckets : []).length;
                return stringifyAmount('Bucket', count, 'No');
            }
        );

        this.durationOptions = durationOptions;
        this.selectedDuration = ko.observable(durationOptions[0].value);

        this.currentUsage = ko.pureComputed(
            () => {
                const pools = systemInfo() ? systemInfo().pools : [];
                return assignWith(
                    {},
                    ...pools.map( pool => pool.storage ),
                    (a, b) => sumSize(a || 0, b || 0)
                );
            }
        );

        this.legendItems = chartDatasets.map(
            ({ label, color, key }) => {
                const value = ko.pureComputed(
                    () => this.currentUsage()[key]
                ).extend({
                    formatSize: true
                });

                return { color, label, value };
            }
        );

        this.samples = ko.pureComputed(
            () => (systemUsageHistory() || []).concat({
                timestamp: this.now,
                storage: this.currentUsage()
            })
        );

        this.chartOptions = ko.pureComputed(
            () => this.getChartOptions()
        );

        this.chartData = ko.pureComputed(
            () => this.getChartData()
        );

        this.isConnectApplicationWizardVisible = ko.observable(false);

        loadSystemUsageHistory();
    }

    getChartOptions() {
        const { stepSize, duration } = this.selectedDuration();
        const start = this.endOfDay - moment.duration(duration, 'days').asMilliseconds();
        const end = this.endOfDay;
        const gutter = parseInt(style['gutter']);

        const useFixedMax = this.samples().every(
            ({ storage }) => storage.free === 0  &&
                storage.unavailable_free === 0 &&
                storage.used === 0
        );

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
                            callback: t => moment(t).format('D MMM'),
                            maxTicksLimit: 10000,
                            min: start,
                            max: end,
                            stepSize: moment.duration(stepSize, 'days').asMilliseconds(),
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
                    title: items => moment(items[0].xLabel).format('D MMM HH:mm:ss'),
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

    getChartData() {
        if (!systemInfo()) {
            return {};
        }

        const { duration } = this.selectedDuration();
        const start = this.endOfDay - moment.duration(duration, 'days').asMilliseconds();
        const end = this.endOfDay;
        const filtered = filterSamples(this.samples(), start, end);
        const datasets = chartDatasets.map(
            ({ key, color, fill }) => ({
                lineTension: 0,
                borderWidth: 1,
                borderColor: color,
                backgroundColor: fill,
                pointRadius: 0,
                pointHitRadius: 10,
                data: filtered.map(
                    ({ timestamp, storage }) => ({
                        x: timestamp,
                        y: toBytes(storage[key])
                    })
                )
            })
        );

        return { datasets };
    }

    showConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(true);
    }

    hideConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(false);
    }
}

export default {
    viewModel: BucketsOverviewViewModel,
    template: template
};
