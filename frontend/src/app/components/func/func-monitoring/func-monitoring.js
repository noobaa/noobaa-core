import template from './func-monitoring.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';
import moment from 'moment';
import { deepFreeze, colorToRgb } from 'utils';

function colorToRgbaString(color, alpha){
    let [r, b, g] = colorToRgb(color);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const responseTimeOptions = deepFreeze({
    maintainAspectRatio: false,
    title: {
        display: true,
        text: 'Response Time Sampling'
    },
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
    maintainAspectRatio: false,
    title: {
        display: true,
        text: 'Request and error count over time'
    },
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

class FuncMonitoringViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.responseTimeOptions = responseTimeOptions;
        this.responseTimeData = ko.pureComputed(
            () => {
                let { stats } = func() || {};
                if (!stats) {
                    return;
                }

                return {
                    datasets: [
                        {
                            label: 'Last 10 Minutes',
                            borderColor: style['color8'],
                            backgroundColor: colorToRgbaString(style['color8'], .1),
                            data: stats.response_time_last_10_minutes.percentiles.map(
                                p => ({ x: p.percent, y: p.value })
                            )
                        },
                        {
                            label: 'Last Hour',
                            borderColor: style['color11'],
                            backgroundColor: colorToRgbaString(style['color11'], .1),
                            data: stats.response_time_last_hour.percentiles.map(
                                p => ({ x: p.percent, y: p.value })
                            )
                        },
                        {
                            label: 'Last day',
                            borderColor: style['color12'],
                            backgroundColor: colorToRgbaString(style['color12'], .1),
                            data: stats.response_time_last_day.percentiles.map(
                                p => ({ x: p.percent, y: p.value })
                            )
                        }
                    ]
                };
            }
        );

        this.errorsOptions = errorsOptions;
        this.errorsData =  ko.pureComputed(
            () => {
                let { stats } = func() || {};
                if (!stats) {
                    return;
                }

                return {
                    datasets: [
                        {
                            label: 'Requests',
                            borderColor: style['color12'],
                            backgroundColor: colorToRgbaString(style['color12'], .1),
                            fill: true,
                            data: stats.requests_over_time.map(
                                r => ({ x: r.time, y: r.requests - r.errors })
                            )
                        },
                        {
                            label: 'Errors',
                            borderColor: style['color10'],
                            backgroundColor: colorToRgbaString(style['color10'], .1),
                            fill: true,
                            data: stats.requests_over_time.map(
                                r => ({ x: r.time, y: r.errors })
                            )
                        }
                    ]
                };
            }
        );
    }
}

export default {
    viewModel: FuncMonitoringViewModel,
    template: template
};
