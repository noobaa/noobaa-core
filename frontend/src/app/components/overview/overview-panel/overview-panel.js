import template from './overview-panel.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo, poolHistory } from 'model';
import style from 'style';
import { deepFreeze, assignWith, keyBy, clamp } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { hexToRgb } from 'utils/color-utils';
import moment from 'moment';

const endOfToday = moment().add(1, 'day').startOf('day').valueOf();

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

        this.isInstallNodeModalVisible = ko.observable(false);
        this.isConnectApplicationWizardVisible = ko.observable(false);
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
