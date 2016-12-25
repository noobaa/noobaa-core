import template from './overview-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo, poolHistory } from 'model';
import style from 'style';
import { deepFreeze, assignWith, keyBy, clamp } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { hexToRgb } from 'utils/color-utils';
import moment from 'moment';

const now = Date.now();
const endOfToday = moment(now).add(1, 'day').startOf('day').valueOf();

const storageHistoryDurationOptions = deepFreeze([
    {
        label: 'Last Week',
        value: moment.duration(7, 'day').milliseconds()
    },
    {
        label : 'Last Month',
        value: moment.duration(30, 'day').milliseconds()
    }
]);

const storageHistoryChartSets = deepFreeze([
    {
        name: 'used',
        color: style['color11'],
        fill: hexToRgb(style['color11'], .2)
    },
    {
        name: 'unavailable_free',
        color: style['color10'],
        fill: hexToRgb(style['color10'], .6)
    },
    {
        name: 'free',
        color: style['color12'],
        fill: hexToRgb(style['color12'], .6)
    }
]);

class OverviewPanelViewModel extends Disposable {
    constructor() {
        super();

        this.nodePoolsCount = ko.pureComputed(
            () => {
                const count = (systemInfo() ? systemInfo().pools : [])
                    .filter(
                        pool => Boolean(pool.nodes)
                    )
                    .length;

                return stringifyAmount('Resource', count, 'No');
            }
        );

        const nodeCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().nodes.count : 0
        ).extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.nodeCountText = ko.pureComputed(
            () => `${nodeCount()} Nodes`
        );

        const onlineNodeCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().nodes.online : 0
        );

        const offlineNodeCount = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return 0;
                }

                const { count, online } = systemInfo().nodes;
                return count - online;
            }
        );

        const nodeWithIssuesCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().nodes.has_issues : 0
        );

        this.nodeChartValue = [
            {
                label: 'Online',
                value: onlineNodeCount,
                color: style['color12']
            },
            {
                label: 'Offline',
                value: offlineNodeCount,
                color: style['color10']
            },
            {
                label: 'Has Issues',
                value: nodeWithIssuesCount,
                color: style['color11']
            }
        ];

        this.systemCapacity = ko.pureComputed(
            () => systemInfo() && systemInfo().storage.total
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatSize: true
        });

        const resourceCounters = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : [])
                .filter(
                    pool => Boolean(pool.cloud_info)
                )
                .map(
                    pool =>  pool.cloud_info.endpoint_type
                )
                .reduce(
                    (counters, type) => {
                        ++counters.ALL;
                        ++counters[type];
                        return counters;
                    },
                    { ALL: 0, AWS: 0, AZURE: 0, S3_COMPATIBLE: 0 }
                )
        );

        this.cloudResourceCount = ko.pureComputed(
            () => stringifyAmount(
                'Resource',
                resourceCounters().ALL,
                'No'
            )
        );

        this.awsResourceIcon = ko.pureComputed(
            () => resourceCounters().AWS === 0 ?
                'aws-s3-resource' :
                'aws-s3-resource-colored'
        );

        this.awsResourceCount = ko.pureComputed(
            () => stringifyAmount(
                'Resource',
                resourceCounters().AWS,
                'No'
            )
        );

        this.azureResourceIcon = ko.pureComputed(
            () => resourceCounters().AZURE === 0 ?
                'azure-resource' :
                'azure-resource-colored'
        );

        this.azureResourceCount = ko.pureComputed(
            () => stringifyAmount(
                'Resource',
                resourceCounters().AZURE,
                'No'
            )
        );

        this.genericResourceIcon = ko.pureComputed(
            () => resourceCounters().S3_COMPATIBLE === 0 ?
                'cloud-resource' :
                'cloud-resource-colored'
        );

        this.genericResourceCount = ko.pureComputed(
            () => stringifyAmount(
                'Resource',
                resourceCounters().S3_COMPATIBLE,
                'No'
            )
        );

        this.serverCount = ko.pureComputed(
            () => {
                const count = (
                    systemInfo() ? systemInfo().cluster.shards[0].servers : []
                ).length;

                return stringifyAmount('Server', count, 'No');
            }
        );

        this.bucketCount = ko.pureComputed(
            () => {
                const count = (systemInfo() ? systemInfo().buckets : []).length;
                return stringifyAmount('Bucket', count, 'No');
            }
        );

        this.storageSummary = [
            {
                label: 'Used',
                value: '640TB'
            },
            {
                label: 'Unavailable',
                value: '80TB'
            },
            {
                label: 'Free',
                value: '1.9TB'
            }
        ];

        this.storageHistoryDurationOptions = storageHistoryDurationOptions;
        this.selectedStorageHistoryDuration = ko.observable(
            storageHistoryDurationOptions[0].value
        );

        this.storageHistoryChartOptions = ko.pureComputed(
            () => this._storageHistoryChartOptions()
        );

        this.storageHistoryChartData = ko.pureComputed(
            () => this._storageHistoryChartDatasets()
        );

        this.isInstallNodeModalVisible = ko.observable(false);
        this.isConnectApplicationWizardVisible = ko.observable(false);
    }

    _storageHistoryChartOptions() {
        const duration = this.selectedStorageHistoryDuration();
        const start = endOfToday - moment.duration(duration, 'day').milliseconds();
        const end = endOfToday;

        return {
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
                            callback: i => moment(i).format('D MMM'),
                            maxTicksLimit: 10000,
                            min: start,
                            max: end,
                            stepSize: 24 * 60 * 60 * 1000,
                            fontColor: style['color7'],
                            fontFamily: style['font-family1'],
                            fontSize: 8,
                            maxRotation: 0
                        }
                    }
                ],
                yAxes: [
                    {
                        stacked: true,
                        gridLines: {
                            color: style['color15']
                        },
                        ticks: {
                            fontColor: style['color7'],
                            fontFamily: style['font-family1'],
                            fontSize: 8,
                            maxRotation: 0
                        }
                    }
                ]
            }
        };
    }

    _storageHistoryChartDatasets() {
        const sets = storageHistoryChartSets;
        const duration = this.selectedStorageHistoryDuration();
        const start = endOfToday - moment.duration(duration, 'day').milliseconds();
        const end = endOfToday;

        const sorted = poolHistory().sort(
            (s1, s2) => s1.time_stamp - s2.time_stamp
        );

        const filtered = [];
        for (const sample of sorted) {
            if (sample.time_stamp <= start) {
                filtered[0] = sample;
            } else {
                filtered.push(sample);
                if (end <= sample.time_stamp) break;
            }
        }

        const compacted = filtered.map(
            ({ time_stamp, pool_list }) => ({
                timestamp: clamp(time_stamp, start, end),
                storage: pool_list.reduce(
                    (sum, pool) => assignWith(sum, pool.storage, (v1, v2) => v1 + v2),
                    keyBy(sets, set => set.name, () => 0)
                )
            })
        );

        const datasets = sets.map(
            ({ name, color, fill }) => ({
                lineTension: 0,
                borderWidth: 1,
                borderColor: color,
                backgroundColor: fill,
                pointRadius: 1,
                pointHitRadius: 10,
                data: compacted.map(
                    ({ timestamp, storage }) => ({
                        x: timestamp,
                        y: storage[name]
                    })
                )
            })
        );

        return { datasets };
    }

    showInstallNodeModal() {
        this.isInstallNodeModalVisible(true);
    }

    hideInstallNodeModal() {
        this.isInstallNodeModalVisible(false);
    }

    showConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(true);
    }

    hideConnectApplicationWizard() {
        this.isConnectApplicationWizardVisible(false);
    }
}

export default {
    viewModel: OverviewPanelViewModel,
    template: template
};
