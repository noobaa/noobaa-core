import template from './func-monitoring.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';
import moment from 'moment';

class FuncMonitoringViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.ready = ko.pureComputed(
            () => !!func()
        );

        this.responseTimeChart = ko.pureComputed(
            () => func() && {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'Last 10 Minutes',
                        borderColor: style.color8,
                        backgroundColor: hexColorToRGBA(style.color8, 0.1),
                        data: func().stats.response_time_last_10_minutes.percentiles
                            .map(p => ({
                                x: p.percent,
                                y: p.value
                            }))
                    }, {
                        label: 'Last Hour',
                        borderColor: style.color11,
                        backgroundColor: hexColorToRGBA(style.color11, 0.1),
                        data: func().stats.response_time_last_hour.percentiles
                            .map(p => ({
                                x: p.percent,
                                y: p.value
                            }))
                    }, {
                        label: 'Last Day',
                        borderColor: style.color12,
                        backgroundColor: hexColorToRGBA(style.color12, 0.1),
                        data: func().stats.response_time_last_day.percentiles
                            .map(p => ({
                                x: p.percent,
                                y: p.value
                            }))
                    }]
                },
                options: {
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
                                callback: value => value + '%'
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
                                callback: value => (
                                    value < 1000 ?
                                    value + ' ms' :
                                    (value/1000).toFixed(1) + ' sec')
                            }
                        }]
                    }
                }
            }
        );

        this.errorsChart = ko.pureComputed(
            () => func() && {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'Requests',
                        borderColor: style.color12,
                        backgroundColor: hexColorToRGBA(style.color12, 0.1),
                        fill: true,
                        data: func().stats.requests_over_time.map(r => ({
                            x: r.time,
                            y: r.requests - r.errors
                        }))
                    }, {
                        label: 'Errors',
                        borderColor: style.color10,
                        backgroundColor: hexColorToRGBA(style.color10, 0.1),
                        fill: true,
                        data: func().stats.requests_over_time.map(r => ({
                            x: r.time,
                            y: r.errors
                        }))
                    }]
                },
                options: {
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
                }
            }
        );

    }

}

function hexColorToRGBA(hex, alpha) {
    return `rgba(${
        parseInt(hex.slice(1,3), 16)
    }, ${
        parseInt(hex.slice(3,5), 16)
    }, ${
        parseInt(hex.slice(5,7), 16)
    }, ${alpha})`;
}

export default {
    viewModel: FuncMonitoringViewModel,
    template: template
};
