/* Copyright (C) 2016 NooBaa */

import Observer from 'observer';
import template from './buckets-overview.html';
import { realizeUri } from 'utils/browser-utils';
import { stringifyAmount } from 'utils/string-utils';
import { deepFreeze, mapValues, last, flatMap } from 'utils/core-utils';
import { sumSize, interpolateSizes, toBytes, formatSize } from 'utils/size-utils';
import { hexToRgb } from 'utils/color-utils';
import { state$, action$ } from 'state';
import * as routes from 'routes';
import ko from 'knockout';
import moment from 'moment';
import style from 'style';
import {
    requestLocation,
    fetchSystemStorageHistory,
    openConnectAppModal
} from 'action-creators';

const minRedrawInterval = 5000;
const durations = deepFreeze({
    DAY: {
        label: 'Day',
        timespan: 24,
        stepSize: 4,
        stepUnit: 'hour',
        tickFormat: 'HH:mm',
        points: true
    },
    WEEK: {
        label: 'Week',
        timespan: 7,
        stepSize: 1,
        stepUnit: 'day',
        tickFormat: 'D MMM',
        points: false
    },
    MONTH: {
        label: 'Month',
        timespan: 30,
        stepSize: 6,
        stepUnit: 'day',
        tickFormat: 'D MMM',
        points: false
    }
});

const chartDatasets = deepFreeze([
    {
        key: 'hosts',
        label: 'Used on Nodes',
        labelPadding: 10,
        color: style['color8']
    },
    {
        key: 'cloud',
        label: 'Used on Cloud',
        labelPadding: 10,
        color: style['color6']
    },
    {
        key: 'internal',
        label: 'Used on Internal',
        labelPadding: 10,
        color: style['color16']
    }
]);

const firstSampleHideDuration = moment.duration(1, 'hours').asMilliseconds();

function _getChartEmptyMessage(showSamples, samples, selectedDatasets) {
    if (!selectedDatasets.length) return 'No resources selected for display';
    if (!showSamples) return 'Not enough usage history to display';

    const datasetKeys = selectedDatasets.map(set => set.key);
    const sum = sumSize(...flatMap(
        datasetKeys,
        key => samples.map(sample => sample[key])
    ));

    return toBytes(sum) === 0 ? 'No data uploaded yet' : '';
}

function _shouldRedraw(lastDuration, currentDuration, lastPoints, currentPoints) {
    const shouldNotRedraw = lastDuration === currentDuration &&
        lastPoints.length === currentPoints.length &&
        currentPoints
            .some((currentPoint, i) => (
                currentPoint.x - lastPoints[i].x < minRedrawInterval &&
                currentPoint.y === lastPoints[i].y
            ));

    return !shouldNotRedraw;
}

function _getTimespanBounds(unit, timespan, now) {
    const t = moment(now).add(1, unit).startOf(unit);
    const end = t.valueOf();
    const start = t.subtract(timespan, unit).startOf(unit).valueOf();
    return { end, start };
}

function _interpolateSamples(sample0, sample1, timestamp) {
    const dt = (timestamp - sample0.timestamp) / (sample1.timestamp - sample0.timestamp);
    return mapValues(
        sample0,
        (value, key) => key !== 'timestamp' ?
            interpolateSizes(value, sample1[key], dt) :
            timestamp
    );
}

function _filterSamples(samples, start, end) {
    const filtered = [];
    for (const sample of samples) {
        if (sample.timestamp <= start) {
            filtered[0] = sample;
        } else {
            filtered.push(sample);
            if (sample.timestamp >= end) break;
        }
    }

    if (filtered.length > 1) {
        const [first, second] = filtered;
        if (first.timestamp < start) {
            filtered[0] = _interpolateSamples(first, second, start);
        }

        const [secondToLast, last] = filtered;
        if (last.timestamp > end) {
            filtered[filtered.length - 1] = _interpolateSamples(secondToLast, last, end);
        }
    }

    return filtered;
}

function _getChartOptions(selectedDatasets, samples, durationSettings, start, end, timezone) {
    const gutter = parseInt(style['gutter']);
    const { stepSize, stepUnit, tickFormat } = durationSettings;
    const datasetKeys = Object.values(selectedDatasets).map(set => set.key);
    const useFixedMax = samples.every(sample => datasetKeys.every(key => sample[key] === 0));

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
                        callback: t => moment.tz(t, timezone).format(tickFormat),
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
                label: item => `  ${
                    selectedDatasets[item.datasetIndex].label
                    }  ${
                    formatSize(item.yLabel)
                    }`,
                labelColor: item => ({
                    backgroundColor: selectedDatasets[item.datasetIndex].color,
                    borderColor: 'transparent'
                })
            }
        }
    };
}

function _getChartParams(selectedDatasets, used, storageHistory, selectedDuration, now, timezone) {
    const durationSettings = durations[selectedDuration];
    const { stepUnit, timespan, points } = durationSettings;
    const { start, end } = _getTimespanBounds(stepUnit, timespan, now);
    const currSample = {
        timestamp: now,
        hosts: used.hostPools,
        cloud: used.cloudResources,
        internal: used.internalResources
    };
    const historySamples = storageHistory
        .map(record => ({
            timestamp: record.timestamp,
            hosts: record.hosts.used || 0,
            cloud: record.cloud.used || 0,
            internal: record.internal.used || 0
        }));
    const [firstSample, secondSample] = historySamples;
    const showSamples = secondSample || (firstSample && (now - firstSample.timestamp > firstSampleHideDuration));
    const allSamples = showSamples ? [...historySamples, currSample] : [];
    const filteredSamples = _filterSamples(allSamples, start, end);
    const emptyChartMessage = _getChartEmptyMessage(showSamples, filteredSamples, selectedDatasets);
    const options = _getChartOptions(selectedDatasets, filteredSamples, durationSettings, start, end, timezone);
    const datasets = selectedDatasets
        .map(({ key, color }) => ({
            lineTension: 0,
            borderWidth: 2,
            borderColor: color,
            backgroundColor: 'transparent',
            pointRadius: points ? 2 : 0,
            pointBorderWidth: 4,
            pointHitRadius: 10,
            pointBackgroundColor: style['color6'],
            pointBorderColor: hexToRgb(style['color6'], 0.2),
            pointHoverBorderColor: 'transparent',
            data: filteredSamples
                .map(sample => ({
                    x: sample.timestamp,
                    y: toBytes(sample[key])
                }))
        })
    );

    return {
        options,
        data: { datasets },
        emptyChartMessage
    };
}

class BucketsOverviewViewModel extends Observer{
    constructor() {
        super();

        this.pathname = '';
        this.lastDurationFilter = '';
        this.lastDataPoints = [];
        this.durationOptions = Object.entries(durations)
            .map(pair => ({
                value: pair[0],
                label: pair[1].label
            }));

        this.location = null;
        this.dataLoaded = ko.observable();
        this.bucketsLinkText = ko.observable();
        this.bucketsLinkHref = ko.observable();
        this.selectedDuration = ko.observable();
        this.hiddenDatasets = null;
        this.hideHosts = ko.observable();
        this.hideCloud = ko.observable();
        this.hideInternal = ko.observable();
        this.chartParams = ko.observable();
        this.emptyChartMessage = ko.observable();
        this.usedValues = [
            {
                label: 'Used on Nodes',
                value: ko.observable(),
                disabled: ko.pc(
                    this.hideHosts,
                    val => this.onToggleDataset('hosts', !val)
                ),
                color : style['color8']
            },
            {
                label: 'Used on Cloud',
                value: ko.observable(),
                disabled: ko.pc(
                    this.hideCloud,
                    val => this.onToggleDataset('cloud', !val)
                ),
                color : style['color6']
            },
            {
                label: 'Used on Internal',
                value: ko.observable(),
                disabled: ko.pc(
                    this.hideInternal,
                    val => this.onToggleDataset('internal', !val)
                ),
                color : style['color16']
            }
        ];

        this.observe(state$.get('location'), this.onLocation);
        this.observe(
            state$.getMany(
                'buckets',
                'hostPools',
                'cloudResources',
                'internalResources',
                ['topology', 'servers'],
                'storageHistory'
            ),
            this.onState
        );
    }

    onLocation(location) {
        // Should move inside onState without creating an
        // multipule chart redraws
        this.location = location;
        action$.onNext(fetchSystemStorageHistory());
    }

    onState(state) {
        if (!state.every(Boolean)) {
            this.bucketsLinkText('');
            this.dataLoaded(false);
            return;
        }

        const [
            buckets,
            hostPools,
            cloudResources,
            internalResources,
            servers,
            storageHistory
        ] = state;

        const { query, params } = this.location;
        const selectedDuration = query.selectedDuration || this.durationOptions[0].value;
        const hiddenDatasets = query.hiddenDatasets ? query.hiddenDatasets.split(',') : [];
        const { system } = params;
        const bucketList = Object.values(buckets);
        const bucketsLinkText = stringifyAmount('bucket', bucketList.length);
        const bucketsLinkHref = realizeUri(routes.buckets, { system });
        const used = mapValues(
            { hostPools, cloudResources, internalResources },
            group => {
                const usedList = Object.values(group).map(res => res.storage.used || 0);
                return sumSize(...usedList);
            }
        );
        const now = Date.now();
        const { timezone } = Object.values(servers).find(server => server.isMaster);
        const datasets = chartDatasets.filter(({ key }) => !hiddenDatasets.includes(key));
        const chartParams = _getChartParams(datasets, used, storageHistory, selectedDuration, now, timezone);
        const currentDataPoints = chartParams.data.datasets
            .map(ds => last(ds.data))
            .filter(Boolean);


        this.bucketsLinkText(bucketsLinkText);
        this.bucketsLinkHref(bucketsLinkHref);
        this.selectedDuration(selectedDuration);
        this.hiddenDatasets = hiddenDatasets;
        this.hideHosts(hiddenDatasets.includes('hosts'));
        this.hideCloud(hiddenDatasets.includes('cloud'));
        this.hideInternal(hiddenDatasets.includes('internal'));
        this.usedValues[0].value(used.hostPools);
        this.usedValues[1].value(used.cloudResources);
        this.usedValues[2].value(used.internalResources);
        this.emptyChartMessage(chartParams.emptyChartMessage);

        if (_shouldRedraw(
                this.lastDurationFilter,
                selectedDuration,
                this.lastDataPoints,
                currentDataPoints
            )
        ) {
            this.chartParams(chartParams);
        }

        this.dataLoaded(true);
        this.lastDurationFilter = selectedDuration;
        this.lastDataPoints = currentDataPoints;
    }

    onSelectDuration(duration) {
        const query = {
            ...this.location.query,
            selectedDuration: duration
        };

        const url = realizeUri(this.location.pathname, {}, query);
        action$.onNext(requestLocation(url, true));
    }

    onConnectApplication() {
        action$.onNext(openConnectAppModal());
    }

    onToggleDataset(name, value) {
        const { query } = this.location;
        const set = new Set(this.hiddenDatasets);
        value ? set.delete(name) : set.add(name);
        const hiddenDatasets = set.size > 0 ? Array.from(set.values()) : undefined;
        const updatedQuery = { ...query, hiddenDatasets };

        const url = realizeUri(this.location.pathname, {}, updatedQuery);
        action$.onNext(requestLocation(url, true));
    }
}


export default {
    viewModel: BucketsOverviewViewModel,
    template: template
};
