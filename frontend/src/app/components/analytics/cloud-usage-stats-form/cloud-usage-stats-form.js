/* Copyright (C) 2016 NooBaa */

import template from './cloud-usage-stats-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, sumBy } from 'utils/core-utils';
import { cloudServices } from 'utils/cloud-utils';
import { realizeUri } from 'utils/browser-utils';
import { toBytes, sumSize, formatSize } from 'utils/size-utils';
import { requestLocation, fetchCloudUsageStats, dropCloudUsageStats } from 'action-creators';
import numeral from 'numeral';
import themes from 'themes';

const durationOptions = deepFreeze([
    {
        label: 'Last 24 Hours',
        value: 'DAY'
    },
    {
        label: 'Last 7 Days',
        value: 'WEEK'
    },
    {
        label: 'Last 4 Weeks',
        value: 'MONTH'
    }
]);

const s3CompatibleOption = {
    value: 'S3_COMPATIBLE',
    label: 'S3 Compatible service',
    icon: 'cloud'
};

const aspectRatio = 1.5;

class CloudUsageStatsFormViewModel extends ConnectableViewModel {
    pathname = '';
    serviceOptions = ko.observableArray();
    durationOptions = durationOptions;
    dataReady = ko.observable();
    selectedServices = ko.observableArray();
    selectedDuration = ko.observable()
    totalReads = ko.observable();
    totalWrites = ko.observable();
    totalEgress = ko.observable();
    ioChart = {
        type: 'bar',
        data: ko.observable(),
        options: {
            aspectRatio,
            scales: {
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'I/O Operations'
                    },
                    ticks: {
                        callback: count => `${
                            numeral(count).format('0,0')
                        }${
                            ' '.repeat(5)
                        }`
                    }
                }]
            },
            tooltips: {
                position: 'nearest',
                callbacks: {
                    title: items => items[0].xLabel,
                    label: item => `Total ${
                        item.datasetIndex === 0 ? 'Reads' : 'Writes'
                    }: ${
                        item.yLabel
                    }`
                }
            }
        }
    };
    egressChart = {
        type: 'bar',
        data: ko.observable(),
        options: {
            aspectRatio,
            scales: {
                yAxes: [{
                    scaleLabel: {
                        display: true,
                        labelString: 'Egress'
                    },
                    ticks: {
                        suggestedMax: 10,
                        callback: size => `${
                            size && formatSize(size)
                        }${
                            ' '.repeat(5)
                        }`
                    }
                }]
            },
            tooltips: {
                position: 'nearest',
                displayColors: false,
                callbacks: {
                    label: item => `Total Egress: ${formatSize(item.yLabel)}`
                }
            }
        }
    };

    onState(state, params) {
        super.onState(state, params);
        this.fetchStats(state);
    }

    selectState(state) {
        const { cloudUsageStats, location, session } = state;
        return [
            cloudUsageStats,
            location,
            themes[session.uiTheme]
        ];
    }

    mapStateToProps(cloudUsageStats, location, theme) {
        const { pathname, query } = location;
        const duration = query.duration || 'DAY';

        if (!cloudUsageStats.usage) {
            ko.assignToProps(this, {
                dataReady: false,
                pathname: pathname,
                serviceOptions: [],
                selectedServices: [],
                selectedDuration: duration
            });

        } else {
            const serviceOptions = Object.keys(cloudUsageStats.usage)
                .map(service => {
                    if (service === 'S3_COMPATIBLE') {
                        return s3CompatibleOption;
                    } else {
                        const { value, displayName: label, icon, selectedIcon } = cloudServices
                            .find(meta => meta.value === service);

                        return { value, label, icon, selectedIcon };
                    }
                });

            const services =
                (query.services === 'NONE' && []) ||
                (query.services && query.services.split('|')) ||
                serviceOptions.map(option => option.value);

            const bars = services.map(service => {
                const { label } = serviceOptions.find(option => option.value === service);
                const { readCount: reads, writeCount: writes, readSize } = cloudUsageStats.usage[service];
                const egress = toBytes(readSize);
                return { label, reads, writes, egress };
            });

            const totalReads = sumBy(bars, bar => bar.reads);
            const totalWrites = sumBy(bars, bar => bar.writes);
            const totalEgress = sumSize(...bars.map(bar => bar.egress));

            const ioChart = {
                data: {
                    labels: bars.map(bar => bar.label),
                    datasets: [
                        {
                            backgroundColor: theme.color20,
                            data: bars.map(bar => bar.reads)
                        },
                        {
                            backgroundColor: theme.color28,
                            data: bars.map(bar => bar.writes)
                        }
                    ]
                }
            };

            const egressChart = {
                data: {
                    labels: bars.map(bar => bar.label),
                    datasets: [{
                        backgroundColor: theme.color20,
                        data: bars.map(bar => bar.egress)
                    }]
                }
            };

            ko.assignToProps(this, {
                dataReady: true,
                pathname: pathname,
                serviceOptions: serviceOptions,
                selectedServices: services,
                selectedDuration: duration,
                totalReads: totalReads,
                totalWrites: totalWrites,
                totalEgress: totalEgress,
                ioChart: ioChart,
                egressChart: egressChart
            });
        }
    }

    fetchStats(state) {
        const duration = this.selectedDuration();
        const { query } = state.cloudUsageStats;
        if (!query || query.duration !== duration) {
            this.dispatch(fetchCloudUsageStats(duration));
        }
    }

    onSelectServices(services) {
        this.onQuery({ services });
    }

    onSelectDuration(duration) {
        this.onQuery({ duration });
    }

    onQuery(query) {
        const {
            services: _services = this.selectedServices(),
            duration = this.selectedDuration()
        } = query;

        const services = _services.length > 0 ? _services.join('|') : 'NONE';
        const url = realizeUri(this.pathname, {}, { services, duration });
        this.dispatch(requestLocation(url));
    }

    dispose(){
        this.dispatch(dropCloudUsageStats());
        super.dispose();
    }
}

export default {
    viewModel: CloudUsageStatsFormViewModel,
    template: template
};
