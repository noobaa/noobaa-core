/* Copyright (C) 2016 NooBaa */

import template from './func-monitoring.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import style from 'style';
import moment from 'moment';
import { deepFreeze } from 'utils/core-utils';
import { hexToRgb } from 'utils/color-utils';

const responseTimeOptions = deepFreeze({
    maintainAspectRatio: true,
    aspectRatio: 3,
    scales: {
        xAxes: [{
            display: true,
            type: 'linear',
            position: 'bottom',
            scaleLabel: {
                display: true,
                labelString: 'Percentile of requests'
            },
            ticks: {
                beginAtZero: true,
                min: 0,
                max: 100,
                callback: value => `${value}%`
            }
        }],
        yAxes: [{
            display: true,
            type: 'linear',
            position: 'left',
            scaleLabel: {
                display: true,
                labelString: 'Response Time'
            },
            ticks: {
                beginAtZero: true,
                min: 0,
                callback: value => value < 1000 ?
                    `${value} ms` :
                    `${(value/1000).toFixed(1)} sec`
            }
        }]
    }
});

const errorsOptions = deepFreeze({
    maintainAspectRatio: true,
    aspectRatio: 3,
    scales: {
        xAxes: [{
            display: true,
            type: 'linear',
            position: 'bottom',
            scaleLabel: {
                display: true,
                labelString: 'Time'
            },
            ticks: {
                callback: value => moment(value).format('hh:mm')
            }
        }],
        yAxes: [{
            display: true,
            type: 'linear',
            position: 'left',
            scaleLabel: {
                display: true,
                labelString: 'Count'
            },
            ticks: {
                beginAtZero: true,
                min: 0
            }
        }]
    }
});

class FuncMonitoringViewModel extends BaseViewModel {
    constructor({ func }) {
        super();

        this.responseTimeOptions = responseTimeOptions;
        this.responseTimeLegendItems = ko.pureComputed(() => [
            {
                label: 'Last 10 Minutes',
                color: style['color8']
            },
            {
                label: 'Last Hour',
                color: style['color11']
            },
            {
                label: 'Last Day',
                color: style['color12']
            }
        ]);
        this.responseTimeData = ko.pureComputed(() => {
            let { stats } = func() || {};
            if (!stats) {
                return;
            }

            return {
                datasets: [
                    {
                        borderColor: style['color8'],
                        backgroundColor: hexToRgb(style['color8'], .1),
                        data: stats.response_time_last_10_minutes.percentiles.map(
                            p => ({ x: p.percent, y: p.value })
                        )
                    },
                    {
                        borderColor: style['color11'],
                        backgroundColor: hexToRgb(style['color11'], .1),
                        data: stats.response_time_last_hour.percentiles.map(
                            p => ({ x: p.percent, y: p.value })
                        )
                    },
                    {
                        borderColor: style['color12'],
                        backgroundColor: hexToRgb(style['color12'], .1),
                        data: stats.response_time_last_day.percentiles.map(
                            p => ({ x: p.percent, y: p.value })
                        )
                    }
                ]
            };
        });

        this.errorsOptions = errorsOptions;
        this.errorsLegendItems = ko.pureComputed(() => [
            {
                label: 'Requests',
                color: style['color12']
            },
            {
                label: 'Errors',
                color: style['color10']
            }
        ]);
        this.errorsData =  ko.pureComputed(() => {
            let { stats } = func() || {};
            if (!stats) {
                return;
            }

            return {
                datasets: [
                    {
                        borderColor: style['color12'],
                        backgroundColor: hexToRgb(style['color12'], .1),
                        data: stats.requests_over_time.map(
                            r => ({ x: r.time, y: r.requests - r.errors })
                        )
                    },
                    {
                        borderColor: style['color10'],
                        backgroundColor: hexToRgb(style['color10'], .1),
                        data: stats.requests_over_time.map(
                            r => ({ x: r.time, y: r.errors })
                        )
                    }
                ]
            };
        });
    }
}

export default {
    viewModel: FuncMonitoringViewModel,
    template: template
};
