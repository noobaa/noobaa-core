/* Copyright (C) 2016 NooBaa */

import template from './endpoint-groups-scaling-form.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze, get } from 'utils/core-utils';
import { getFormValues, getFieldValue } from 'utils/form-utils';
import { sumSize, toBytes, formatSize, unitsInBytes } from 'utils/size-utils';
import ko from 'knockout';
import moment from 'moment';
import numeral from 'numeral';
import themes from 'themes';
import {
    updateForm,
    fetchEndpointsHistory,
    dropEndpointsHistory
} from 'action-creators';

const FETCH_THRESHOLD = moment
    .duration(10, 'minute')
    .asMilliseconds();

const throughputGuides = deepFreeze(['PB', 'TB', 'GB', 'MB']
    .map(unit => unitsInBytes[unit]));

const timespanScale = deepFreeze({
    '24_HOURS': {
        label: 'Last 24 hours',
        formatValue: t => moment(t).format('DD MMM HH:mm')
    },
    '7_DAYS': {
        label: 'Last 7 Days',
        formatValue: t => `${
            moment(t).subtract(1, 'day').format('DD MMM')
        } - ${
            moment(t).format('DD MMM')
        }`
    },
    '4_WEEKS': {
        label: 'Last 4 Weeks',
        formatValue: t => `${
            moment(t).subtract(7, 'day').format('DD MMM')
        } - ${
            moment(t).format('DD MMM')
        }`
    }
});

const metricScales = deepFreeze({
    ENDPOINTS: {
        label: 'Endpoint Count',
        isFixed: true,
        getValue: sample => sample.endpointCount,
        formatValue: value => numeral(value).format(',0.[00]'),
        getTicksConf: (data = []) => {
            const maxSample = Math.max(5, ...data);
            const step = Math.ceil(maxSample / 5);
            return { min: 0, max: step * 5, step };
        }
    },
    CPU: {
        label: 'CPU %',
        isFixed: false,
        getValue: sample => sample.cpuUsage,
        formatValue: value => numeral(value).format('%'),
        getTicksConf: (data = []) => {
            const max = Math.max(1, ...data.map(Math.ceil));
            const step = max / 5;
            return { min: 0, max, step };
        }
    },
    MEM: {
        label: 'Memory %',
        isFixed: false,
        getValue: sample => sample.memoryUsage,
        formatValue: value =>  numeral(value).format('%'),
        getTicksConf: () => ({ min: 0, max: 1, step: .2 })
    },
    THROUGHPUT: {
        label: 'Throughput',
        isFixed: false,
        getValue: sample => toBytes(sumSize(sample.readSize, sample.writeSize)),
        formatValue: value => value === 0 ? '0' : formatSize(value),
        getTicksConf: (data = []) => {
            const maxSample = Math.max(unitsInBytes.MB, ...data);
            const bestUnit = throughputGuides.find(size =>
                maxSample / size > (1000/1024)
            );
            const factor =
                (maxSample / (100 * bestUnit) > 1) && (100 * bestUnit) ||
                (maxSample / (10 * bestUnit) > 1) && (10 * bestUnit) ||
                bestUnit;
            const max = Math.ceil(maxSample / factor) * factor;
            return { min: 0, max, step: max / 5 };
        }
    }
});

const timespanOptions = Object.entries(timespanScale)
    .map(pair => ({
        value: pair[0],
        label: pair[1].label
    }));

const metricOptions = Object.entries(metricScales)
    .filter(pair => !pair[1].isFixed)
    .map(pair => ({
        value: pair[0],
        label: pair[1].label
    }));

const chartOptions = {
    scales: {
        yAxes: Object.entries(metricScales).map(pair => {
            const [id, info] = pair;
            return {
                id,
                type: 'linear',
                display: info.isFixed ? true : 'auto',
                position: info.isFixed ? 'right': 'left',
                scaleLabel: {
                    display: true,
                    labelString: info.label
                },
                ticks: {
                    padding: 5,
                    callback: info.formatValue
                },
                beforeDataLimits: scale => {
                    const datasets = get(scale, ['chart', 'config', 'data', 'datasets']);
                    if (!datasets) return;

                    const dataset = datasets.find(dataset =>
                        dataset.yAxisID === scale.options.id
                    );
                    const { min, max, step } = info.getTicksConf(dataset && dataset.data);
                    scale.options.ticks.min = min;
                    scale.options.ticks.max = max;
                    scale.options.ticks.stepSize = step;
                }
            };
        })
    },
    tooltips: {
        position: 'nearest',
        mode: 'index',
        callbacks: {
            title: items => items[0].xLabel,
            label: (item, chartData) => {
                const { yAxisID, data } = chartData.datasets[item.datasetIndex];
                const { label, formatValue } = metricScales[yAxisID];
                return `${label}: ${formatValue(data[item.index])}`;
            }
        }
    }
};

function _perpareChartData(samples, labelFormatter, metric, theme) {
    const { display, getValue } = metricScales[metric];
    const lineColor = theme.color14;

    return {
        labels: samples.map(sample => labelFormatter(sample.timestamp)),
        datasets: [
            {
                order: 2,
                yAxisID: 'ENDPOINTS',
                label: 'Endpoint Count',
                backgroundColor: theme.color20,
                data: samples.map(metricScales.ENDPOINTS.getValue)
            },
            {
                type: 'line',
                order: 1,
                yAxisID: metric,
                label: display,
                borderColor: lineColor,
                backgroundColor: 'transparent',
                pointBackgroundColor: lineColor,
                pointBorderColor: 'transparent',
                pointHoverBorderColor: lineColor,
                pointRadius: 3,
                pointBorderWidth: 4,
                pointHitRadius: 10,
                lineTension: 0,
                fill: false,
                data: samples.map(getValue)
            }
        ]
    };
}
class EndpointGroupsScalingFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    lastFetchRefreshCount = 0;
    formName = this.constructor.name;
    groupOptions = ko.observableArray();
    timespanOptions = timespanOptions;
    metricOptions = metricOptions;
    formFields = {
        initialized: false,
        selectedGroups: [],
        selectedTimespan: '24_HOURS',
        selectedMetric: 'CPU'
    };
    chart = {
        type: 'bar',
        options: chartOptions,
        data: ko.observable(),
        emptyMessage: ko.observable()
    };

    onState(state, params) {
        super.onState(state, params);
        this.fetchEndpointsHistory(state);
        this.initializeForm(state);
    }

    selectState(state) {
        const { endpointGroups, endpointsHistory, forms, session } = state;
        return [
            endpointGroups,
            endpointsHistory,
            forms && forms[this.formName],
            session && themes[session.uiTheme]
        ];
    }

    mapStateToProps(groups, history, form, theme) {
        if (!groups || !history.samples || !theme || !getFieldValue(form, 'initialized')) {
            ko.assignToProps(this, {
                dataReady: false,
                chart: { emptyMessage: 'Loading data...' }
            });

        } else {
            const groupNames = Object.keys(groups);
            const { formatValue } = history.query ? timespanScale[history.query.timespan] : {};

            ko.assignToProps(this, {
                dataReady: true,
                groupOptions: groupNames,
                chart: {
                    data: _perpareChartData(
                        history.samples,
                        formatValue,
                        getFieldValue(form, 'selectedMetric'),
                        theme
                    ),
                    emptyMessage: 'No data to display'
                }
            });
        }
    }

    initializeForm(state) {
        const form = state.forms[this.formName];
        if (!form) return;

        if (state.endpointGroups && !getFieldValue(form, 'initialized')) {
            const update = {
                selectedGroups: Object.keys(state.endpointGroups),
                initialized: true
            };

            this.dispatch(updateForm(this.formName, update, false));
        }
    }

    fetchEndpointsHistory(state) {
        const { query } = state.endpointsHistory;
        const form = state.forms[this.formName];
        if (!form) return;

        const { selectedTimespan, selectedGroups }  = getFormValues(form);
        if (
            !query ||
            (Date.now() - query.timestamp > FETCH_THRESHOLD) ||
            selectedTimespan != query.timespan ||
            selectedGroups.length != query.groups.length ||
            !selectedGroups.every(g => query.groups.includes(g))
        ) {
            this.dispatch(
                fetchEndpointsHistory(selectedGroups, selectedTimespan)
            );
        }
    }

    dispose() {
        this.dispatch(dropEndpointsHistory());
        super.dispose();
    }
}

export default {
    viewModel: EndpointGroupsScalingFormViewModel,
    template: template
};
