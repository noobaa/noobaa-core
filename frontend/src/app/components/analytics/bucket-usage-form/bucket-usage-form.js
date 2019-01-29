/* Copyright (C) 2016 NooBaa */

import template from './bucket-usage-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import moment from 'moment';
import { deepFreeze, sumBy, equalItems, groupBy, makeArray } from 'utils/core-utils';
import { formatSize, toBytes, sumSize } from 'utils/size-utils';
import { getFormValues, getFieldValue } from 'utils/form-utils';
import { colorToRgb, rgbToColor } from 'utils/color-utils';
import { realizeUri } from 'utils/browser-utils';
import themes from 'themes';
import {
    requestLocation,
    updateForm,
    fetchBucketUsageHistory,
    dropBucketUsageHistory
} from 'action-creators';


const durations = deepFreeze({
    DAY: {
        label: 'Last 24 Hours',
        timespan: 24,
        stepSize: 1,
        stepUnit: 'hour',
        tickFormat: 'HH:mm'
    },
    WEEK: {
        label: 'Last 7 Days',
        timespan: 7,
        stepSize: 1,
        stepUnit: 'day',
        tickFormat: 'D MMM'
    },
    MONTH: {
        label: 'Last 4 Weeks',
        timespan: 28,
        stepSize: 7,
        stepUnit: 'day',
        tickFormat: 'D MMM'
    }
});

const durationOptions = deepFreeze(
    Object.entries(durations).map(pair => ({
        value: pair[0],
        label: pair[1].label
    }))
);

const chartTypes = deepFreeze([
    {
        value: 'bar',
        icon: 'bar-chart'
    },
    {
        value: 'line',
        icon: 'line-chart'
    }
]);

function _calcTimeMeta(duration, now) {
    const durationMeta = durations[duration];
    const { timespan, stepUnit, stepSize } = durationMeta;
    const end = moment(now)
        .add(1, stepUnit)
        .startOf(stepUnit)
        .valueOf();

    const start = moment(end)
        .subtract(timespan, stepUnit)
        .valueOf();

    const step = moment.duration(stepSize, stepUnit)
        .valueOf();

    return { start, end, step };
}

function _prepareBarChartParams(samples, timeMeta, tickFormat, _, theme) {
    const { end, start, step} = timeMeta;

    const groups = groupBy(samples, sample =>
        Math.floor((sample.startTime - start) / step)
    );

    const bars = makeArray((end - start) / step, i => {
        const { readSize, writeSize } = groups[i].reduce(
            (aggr, sample) => ({
                readSize: sumSize(aggr.readSize, sample.readSize),
                writeSize: sumSize(aggr.writeSize, sample.writeSize)
            }),
            { readSize: 0, writeSize: 0 }
        );

        const label = `${
            moment(start + i * step).format(tickFormat)
        } - ${
            moment(start + (i + 1) * step).format(tickFormat)
        }`;

        return { label, readSize, writeSize };
    });

    return {
        type: 'bar',
        data: {
            labels: bars.map(bar => bar.label),
            datasets: [
                {
                    backgroundColor: theme.color6,
                    data: bars.map(bar => toBytes(bar.readSize))
                },
                {
                    backgroundColor: theme.color28,
                    data: bars.map(bar => toBytes(bar.writeSize))
                }
            ]
        },
        options: {
            scales: {
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Aggregated R/W'
                    },
                    ticks: {
                        suggestedMax: 10,
                        // Using space for visual padding.
                        callback: size => `${
                            size && formatSize(size)
                        }${
                            ' '.repeat(5)
                        }`
                    }
                }],
                xAxes: [{
                    categoryPercentage: .4,
                    ticks: {
                        fontColor: theme.color10
                    }
                }]
            },
            tooltips: {
                position: 'nearest',
                callbacks: {
                    title: items => items[0].xLabel,
                    label: item => `Total ${
                        item.datasetIndex === 0 ? 'reads' : 'writes'
                    }: ${
                        formatSize(item.yLabel)
                    }`
                }
            }
        },
        emptyMessage: ''
    };
}

function _prepareLineChartParams(samples, timeMeta, tickFormat, now, theme) {
    const data = samples.filter(sample => sample.endTime <= now);
    const commonLineDatasetSettings = {
        pointRadius: 3,
        pointBorderWidth: 4,
        pointHitRadius: 10,
        pointBorderColor: colorToRgb(...rgbToColor(theme.color10), .2),
        pointHoverBorderColor: 'transparent',
        backgroundColor: 'transparent',
        lineTension: 0,
        fill: false
    };

    return {
        type: 'line',
        data: {
            datasets: [
                {
                    ...commonLineDatasetSettings,
                    pointBackgroundColor: theme.color6,
                    borderColor: theme.color6,
                    data: data.map(sample => ({
                        x: sample.endTime + 1,
                        y: toBytes(sample.readSize)
                    }))
                },
                {
                    ...commonLineDatasetSettings,
                    pointBackgroundColor: theme.color28,
                    borderColor: theme.color28,
                    data: data.map(sample => ({
                        x: sample.endTime + 1,
                        y: toBytes(sample.writeSize)
                    }))
                }
            ]
        },
        options: {
            scales: {
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'R/W'
                    },
                    ticks: {
                        suggestedMax: 10,
                        // Using space for visual padding.
                        callback: size => `${
                            size && formatSize(size)
                        }${
                            ' '.repeat(5)
                        }`
                    }
                }],
                xAxes: [{
                    type: 'linear',
                    ticks: {
                        max: timeMeta.end,
                        min: timeMeta.start,
                        stepSize: timeMeta.step,
                        callback: timestamp => [
                            '',
                            moment(timestamp).format(tickFormat)
                        ]
                    }
                }]
            },
            tooltips: {
                position: 'nearest',
                displayColors: false,
                callbacks: {
                    title: items => {
                        const { startTime, endTime } = data[items[0].index];
                        return `${
                            moment(startTime).format('D MMM HH:mm')
                        } - ${
                            moment(endTime).format('D MMM HH:mm')
                        }`;
                    },
                    label: item => `Total ${
                        item.datasetIndex === 0 ? 'reads' : 'writes'
                    }: ${
                        formatSize(item.yLabel)
                    }`
                }
            }
        },
        emptyMessage: ''
    };
}

function _perpareChartParams(chartType, ...args) {
    return (
        (chartType === 'bar' && _prepareBarChartParams(...args)) ||
        (chartType === 'line' && _prepareLineChartParams(...args))
    );
}

class BucketUsageFormViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    dataReady = ko.observable();
    pathname = '';
    durationOptions = durationOptions;
    bucketOptions = ko.observableArray();
    chartTypes = chartTypes;
    totalReads = ko.observable(0)
    totalWrites = ko.observable();
    formFields = {
        initialized: false,
        selectedBuckets: [],
        selectedDuration: durationOptions[0].value
    };
    chart = {
        type: ko.observable(),
        options: ko.observable(),
        data: ko.observable(),
        emptyMessage: ko.observable()
    };

    onState(state, params){
        super.onState(state, params);
        this.initializeForm(state);
        this.fetchThroughput(state);
    }

    initializeForm(state) {
        const form = state.forms[this.formName];
        if (!form) return;

        if (state.buckets && !getFieldValue(form, 'initialized')) {
            const update = {
                selectedBuckets: Object.keys(state.buckets),
                initialized: true
            };

            this.dispatch(updateForm(this.formName, update, false));
        }
    }

    fetchThroughput(state) {
        const form = state.forms[this.formName];
        if (!form) return;

        const { buckets = [], duration } = state.bucketUsageHistory.query || {};
        const { selectedBuckets, selectedDuration } = getFormValues(form);

        if (
            duration !== selectedDuration ||
            !equalItems(buckets, selectedBuckets)
        ) {
            this.dispatch(fetchBucketUsageHistory(selectedBuckets, selectedDuration));
        }
    }

    selectState(state) {
        const { forms, buckets, bucketUsageHistory, location, session } = state;
        return [
            forms[this.formName],
            buckets,
            bucketUsageHistory,
            location,
            themes[session.uiTheme]
        ];
    }

    mapStateToProps(form, buckets, usageHistory, location, theme) {
        const { chart: chartType = 'bar' } = location.query;

        if (!buckets || !usageHistory.samples || !getFieldValue(form, 'initialized')) {
            ko.assignToProps(this, {
                dataReady: false,
                pathname: location.pathname,
                chart: {
                    type: chartType,
                    emptyMessage: 'Loading data...'
                }
            });

        } else {
            const chartDuration = usageHistory.query.duration;
            const { tickFormat } = durations[chartDuration];
            const now = Date.now();
            const timeMeta = _calcTimeMeta(chartDuration, now);
            const { samples } = usageHistory;
            const totalReads = sumBy(samples, sample => toBytes(sample.readSize));
            const totalWrites = sumBy(samples, sample => toBytes(sample.writeSize));

            ko.assignToProps(this, {
                dataReady: true,
                pathname: location.pathname,
                bucketOptions: Object.keys(buckets),
                totalReads: totalReads,
                totalWrites: totalWrites,
                chart: _perpareChartParams(
                    chartType,
                    samples,
                    timeMeta,
                    tickFormat,
                    now,
                    theme
                )
            });
        }
    }

    onChartType(type) {
        const url = realizeUri(this.pathname, {}, { chart: type });
        this.dispatch(requestLocation(url));
    }

    dispose() {
        this.dispatch(dropBucketUsageHistory());
        super.dispose();
    }
}

export default {
    viewModel: BucketUsageFormViewModel,
    template: template
};
