/* Copyright (C) 2016 NooBaa */

import template from './func-monitoring-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import { deepFreeze, equalItems } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { colorToRgb, rgbToColor } from 'utils/color-utils';
import themes from 'themes';
import {
    requestLocation,
    fetchLambdaFuncUsageHistory,
    dropLambdaFuncUsageHistory
} from 'action-creators';

const durationMeta = deepFreeze({
    '60_MIN': {
        label: '60 Minutes',
        unit: 'minute',
        span: 60,
        step: 5,
        tickFormat: 'HH:mm'
    },
    '24_HOURS': {
        label: '24 Hours',
        unit: 'hours',
        span: 24,
        step: 2,
        tickFormat: 'HH:mm'
    },
    '7_DAYS': {
        label: '7 Days',
        unit: 'day',
        span: 7,
        step: 1,
        tickFormat: 'DD/MM'
    },
    '30_DAYS': {
        label: '30 days',
        unit: 'day',
        span: 30,
        step: 3,
        tickFormat: 'DD/MM'
    }
});

function _formatMiliseconds(t) {
    return `${numeral(t).format(',')} ms`;
}

function _reduceDataSets(slices) {
    return slices.reduce((ds, slice) => {
        ds.pre50.push(slice.responsePercentiles[0].value);
        ds.pre90.push(slice.responsePercentiles[1].value);
        ds.pre99.push(slice.responsePercentiles[2].value);
        ds.fulfilled.push(slice.fulfilled);
        ds.rejected.push(slice.rejected);
        return ds;
    }, {
        pre99: [],
        pre90: [],
        pre50: [],
        fulfilled: [],
        rejected: []
    });
}

class FuncMonitoringFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    formatMiliseconds = _formatMiliseconds;
    pathname = '';
    fetchKey = ['', '', '', 0];
    durationOptions = Object.entries(durationMeta).map(pair => ({
        label: pair[1].label,
        value: pair[0]
    }));
    selectedDuration = ko.observable();

    maxResponseTime = ko.observable();
    avgResponseTime = ko.observable();
    responseTimeChart = {
        options: {
            scales: {
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Miliseconds'
                    },
                    ticks: {
                        suggestedMax: 1000,
                        // Using space for visual padding.
                        callback: tick => {
                            const text = numeral(tick).format(',');
                            return `${text}${' '.repeat(5)}`;
                        }
                    }
                }],
                xAxes: [{
                    gridLines: {
                        display: false
                    }
                }]
            },
            tooltips: {
                position: 'nearest',
                callbacks: {
                    label: item => {
                        const value = _formatMiliseconds(item.yLabel);
                        const label =
                            (item.datasetIndex === 0 && '99th') ||
                            (item.datasetIndex === 1 && '90th') ||
                            (item.datasetIndex === 2 && '50th');

                        return `${label} Precentile: ${value}`;
                    }
                }
            }
        },
        data:  ko.observable()
    };

    totalFulfilled = ko.observable();
    totalRejected = ko.observable();
    invocationsChart = {
        options: {
            scales: {
                yAxes: [{
                    stacked: true,
                    scaleLabel: {
                        display: true,
                        labelString: 'Invocations'
                    },
                    ticks: {
                        suggestedMax: 100,
                        // Using space for visual padding.
                        callback: tick => {
                            const text = numeral(tick).format(',');
                            return `${text}${' '.repeat(5)}`;
                        }
                    }
                }],
                xAxes: [{
                    stacked: true,
                    gridLines: {
                        display: false
                    }
                }]
            },
            tooltips: {
                position: 'nearest',
                mode: 'x',
                callbacks: {
                    label: item => {
                        const value = numeral(item.yLabel).format(',');
                        const label =
                            (item.datasetIndex === 0 && 'Success') ||
                            (item.datasetIndex === 1 && 'Errors');

                        return `${label}: ${value}`;
                    }
                }
            }
        },
        data:  ko.observable()
    };

    selectState(state, params) {
        const { funcName, funcVersion } = params;
        const { lambdaUsageHistory, location, session } = state;
        return [
            funcName,
            funcVersion,
            lambdaUsageHistory.data,
            location,
            themes[session.uiTheme]
        ];
    }

    mapStateToProps(funcName, funcVersion, usageHistory, location, theme) {
        const { pathname, query, refreshCount } = location;
        const selectedDuration = query.duration || this.durationOptions[0].value;
        const fetchKey = [funcName, funcVersion, selectedDuration, refreshCount];

        if (!equalItems(fetchKey, this.fetchKey)) {
            this.fetchUsageHistory(...fetchKey);
        }

        if (!usageHistory) {
            ko.assignToProps(this, {
                dataReady: false,
                fetchKey,
                pathname,
                selectedDuration
            });

        } else {
            const { tickFormat } = durationMeta[selectedDuration];
            const { stats, slices } = usageHistory;
            const datasets = _reduceDataSets(slices);
            const commonLineDatasetSettings = {
                pointRadius: 3,
                pointBorderWidth: 4,
                pointHitRadius: 10,
                pointBorderColor: colorToRgb(...rgbToColor(theme.color10), .2),
                pointHoverBorderColor: 'transparent',
                borderJoinStyle: 'round',
                lineTension: 0,
                fill: false,
                backgroundColor: 'transparent'
            };

            ko.assignToProps(this, {
                dataReady: false,
                fetchKey,
                pathname,
                selectedDuration,
                maxResponseTime: stats.maxResponseTime,
                avgResponseTime: stats.invoked > 0 ?
                    Math.round(stats.aggrResponseTime / stats.invoked) :
                    0,
                responseTimeChart: {
                    data: {
                        labels: slices.map(slice =>
                            moment(slice.since).format(tickFormat)
                        ),
                        datasets:[
                            {
                                ...commonLineDatasetSettings,
                                pointBackgroundColor: theme.color6,
                                borderColor: theme.color6,
                                data: datasets.pre99
                            },
                            {
                                ...commonLineDatasetSettings,
                                pointBackgroundColor: theme.color28,
                                borderColor: theme.color28,
                                data: datasets.pre90
                            },
                            {
                                ...commonLineDatasetSettings,
                                pointBackgroundColor: theme.color9,
                                borderColor: theme.color9,
                                data: datasets.pre50
                            }
                        ]
                    }
                },
                totalFulfilled: stats.fulfilled,
                totalRejected: stats.rejected,
                invocationsChart: {
                    data: {
                        labels: slices.map(slice => `${
                            moment(slice.since).format(tickFormat)
                        } - ${
                            moment(slice.till).format(tickFormat)
                        }`),
                        datasets: [
                            {
                                backgroundColor: theme.color21,
                                data: datasets.fulfilled
                            },
                            {
                                backgroundColor: theme.color19,
                                data: datasets.rejected
                            }
                        ]
                    }
                }
            });
        }
    }

    fetchUsageHistory(name, version, duration) {
        if (!name || !version || !duration) {
            return;
        }

        const { unit, span, step } = durationMeta[duration];
        this.dispatch(fetchLambdaFuncUsageHistory(
            name,
            version,
            moment.duration(span - step, unit).asMilliseconds(),
            moment.duration(step, unit).asMilliseconds()
        ));
    }

    onDuration(duration) {
        this.dispatch(requestLocation(
            realizeUri(this.pathname, null, { duration })
        ));
    }

    dispose() {
        this.dispatch(dropLambdaFuncUsageHistory());
        super.dispose();
    }
}

export default {
    viewModel: FuncMonitoringFormViewModel,
    template: template
};
