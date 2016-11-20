import template from './func-monitoring.html';
import Disposable from 'disposable';
import ko from 'knockout';
import style from 'style';

class FuncMonitoringViewModel extends Disposable {
    constructor({ func }) {
        super();

        this.ready = ko.pureComputed(
            () => !!func()
        );

        this.chartOptions = ko.pureComputed(
            () => func() && {
                type: 'line',
                data: {
                    datasets: [{
                        label: 'Last 10 Minutes',
                        borderColor: style.color8,
                        data: func().stats_last_10_minutes.latency_percentiles.map(p => ({
                            x: p.index,
                            y: p.value
                        }))
                    }, {
                        label: 'Last Hour',
                        borderColor: style.color12,
                        data: func().stats_last_hour.latency_percentiles.map(p => ({
                            x: p.index,
                            y: p.value
                        }))
                    }]
                },
                options: {
                    maintainAspectRatio: false,
                    title: {
                        display: true,
                        text: 'Response Time (ms) by Percentiles (%)'
                    },
                    scales: {
                        xAxes: [{
                            title: 'Percentile',
                            display: true,
                            type: 'linear',
                            position: 'bottom',
                            ticks: {
                                beginAtZero:true
                            }
                        }],
                        yAxes: [{
                            title: 'Latency (ms)',
                            display: true,
                            type: 'linear',
                            position: 'left',
                            ticks: {
                                beginAtZero:true
                            }
                        }]
                    }
                }
            }
        );

    }

}

export default {
    viewModel: FuncMonitoringViewModel,
    template: template
};
