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
import { get, getMany } from 'rx-extensions';
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

function _isInternalSotrageUsed(internalStorage, buckets) {
    if (internalStorage.used > 0) {
        return true;
    }

    if (Object.values(buckets).some(bucket =>
        bucket.placement.tiers[0].policyType === 'INTERNAL_STORAGE'
    )) {
        return true;
    }

    return false;

}

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
    const { stepSize, stepUnit, tickFormat } = durationSettings;
    const datasetKeys = Object.values(selectedDatasets).map(set => set.key);
    const useFixedMax = samples.every(sample => datasetKeys.every(key => sample[key] === 0));

    return {
        maintainAspectRatio: false,
        scales: {
            xAxes: [
                {
                    type: 'linear',
                    ticks: {
                        fontSize: 8,
                        min: start,
                        max: end,
                        stepSize: moment.duration(stepSize, stepUnit).asMilliseconds(),
                        maxTicksLimit: 10000,
                        callback: t => moment.tz(t, timezone).format(tickFormat)
                    }
                }
            ],
            yAxes: [
                {
                    ticks: {
                        fontSize: 8,
                        max: useFixedMax ? Math.pow(1024, 2) : undefined,
                        stepSize: useFixedMax ? Math.pow(1024, 2) / 10 : undefined,
                        callback: size => size > 0 ? formatSize(Math.floor(size)) : '0'
                    }
                }
            ]
        },
        tooltips: {
            backgroundColor: hexToRgb(style['color4'], .85),
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
    const currSample = { timestamp: now, ...used };
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
    let datasets = [];
    if (!emptyChartMessage) {
        datasets = selectedDatasets.map(({ key, color }) => ({
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
            data: filteredSamples.map(sample => ({
                x: sample.timestamp,
                y: toBytes(sample[key])
            }))
        }));
    }

    return {
        options,
        data: { datasets },
        emptyChartMessage
    };
}

class BucketsOverviewViewModel extends Observer{
    pathname = '';
    lastDurationFilter = '';
    lastDataPoints = [];
    durationOptions = Object.entries(durations).map(pair => ({
        value: pair[0],
        label: pair[1].label
    }));

    location = null;
    dataLoaded = ko.observable();
    bucketsLinkText = ko.observable();
    bucketsLinkHref = ko.observable();
    selectedDuration = ko.observable();
    hiddenDatasets = null;
    showInternalLegend = ko.observable();
    hideHosts = ko.observable();
    hideCloud = ko.observable();
    hideInternal = ko.observable();
    chartParams = ko.observable();
    emptyChartMessage = ko.observable();
    usedValues = [
        {
            label: 'Used on Nodes',
            value: ko.observable(),
            disabled: ko.pc(
                this.hideHosts,
                val => this.onToggleDataset('hosts', !val)
            ),
            color : style['color8'],
            tooltip: 'The total raw data that was written on all installed nodes in the system'
        },
        {
            label: 'Used on Cloud',
            value: ko.observable(),
            disabled: ko.pc(
                this.hideCloud,
                val => this.onToggleDataset('cloud', !val)
            ),
            color : style['color6'],
            tooltip: 'The total raw data that was written on all configured cloud resources in the system'
        },
        {
            label: 'Used on Internal',
            value: ko.observable(),
            visible: this.showInternalLegend,
            disabled: ko.pc(
                this.hideInternal,
                val => this.onToggleDataset('internal', !val)
            ),
            color : style['color16'],
            tooltip: 'The total raw data that was written to the system internal storage disks'
        }
    ];

    constructor() {
        super();

        this.observe(
            state$.pipe(get('location')),
            this.onLocation
        );

        this.observe(
            state$.pipe(
                getMany(
                    'buckets',
                    'hostPools',
                    'cloudResources',
                    ['system', 'internalStorage'],
                    ['topology', 'servers'],
                    'storageHistory'
                )
            ),
            this.onState
        );
    }

    onLocation(location) {
        // Should move inside onState without creating an
        // multipule chart redraws
        this.location = location;
        action$.next(fetchSystemStorageHistory());
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
            internalStorage,
            servers,
            storageHistory
        ] = state;

        const { query, params } = this.location;
        const selectedDuration = query.selectedDuration || this.durationOptions[0].value;
        const hiddenDatasets = query.hiddenDatasets ? query.hiddenDatasets.split(',') : [];
        const showInternalLegend = _isInternalSotrageUsed(internalStorage, buckets);
        const { system } = params;
        const bucketList = Object.values(buckets);
        const bucketsLinkText = stringifyAmount('bucket', bucketList.length);
        const bucketsLinkHref = realizeUri(routes.buckets, { system });
        const used = {
            hosts: sumSize(...Object.values(hostPools).map(res => res.storage.used || 0)),
            cloud: sumSize(...Object.values(cloudResources).map(res => res.storage.used || 0)),
            internal: internalStorage.used || 0
        };
        const now = Date.now();
        const { timezone } = Object.values(servers).find(server => server.isMaster);
        const datasets = chartDatasets.filter(({ key }) => !hiddenDatasets.includes(key));
        const chartParams = _getChartParams(datasets, used, storageHistory, selectedDuration, now, timezone);
        const currentDataPoints = chartParams.data.datasets
            .map(ds => last(ds.data))
            .filter(Boolean);
        const shouldRedraw = _shouldRedraw(
            this.lastDurationFilter, selectedDuration,
            this.lastDataPoints, currentDataPoints
        );

        ko.assignToProps(this, {
            dataLoaded: true,
            bucketsLinkText: bucketsLinkText,
            bucketsLinkHref: bucketsLinkHref,
            selectedDuration: selectedDuration,
            hiddenDatasets: hiddenDatasets,
            showInternalLegend: showInternalLegend,
            hideHosts: hiddenDatasets.includes('hosts'),
            hideCloud: hiddenDatasets.includes('cloud'),
            hideInternal: !showInternalLegend || hiddenDatasets.includes('internal'),
            usedValues: [
                { value: used.hosts },
                { value: used.cloud },
                { value: used.internal }
            ],
            emptyChartMessage: chartParams.emptyChartMessage,
            chartParams: shouldRedraw ? chartParams : undefined,
            lastDurationFilter: selectedDuration,
            lastDataPoints: currentDataPoints
        });

    }

    onSelectDuration(duration) {
        const query = {
            ...this.location.query,
            selectedDuration: duration
        };

        const url = realizeUri(this.location.pathname, {}, query);
        action$.next(requestLocation(url, true));
    }

    onConnectApplication() {
        action$.next(openConnectAppModal());
    }

    onToggleDataset(name, value) {
        const { query } = this.location;
        const set = new Set(this.hiddenDatasets);
        value ? set.delete(name) : set.add(name);
        const hiddenDatasets = set.size > 0 ? Array.from(set.values()) : undefined;
        const updatedQuery = { ...query, hiddenDatasets };

        const url = realizeUri(this.location.pathname, {}, updatedQuery);
        action$.next(requestLocation(url, true));
    }
}


export default {
    viewModel: BucketsOverviewViewModel,
    template: template
};
