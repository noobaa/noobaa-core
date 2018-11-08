/* Copyright (C) 2016 NooBaa */

import template from './bucket-summary.html';
import chartTooltipTemplate from './chart-tooltip.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze, flatMap, mapValues, sumBy } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { isSizeZero, formatSize, toBytes } from 'utils/size-utils';
import ko from 'knockout';
import style from 'style';
import moment from 'moment';
import numeral from 'numeral';
import {
    getBucketStateIcon,
    getDataBreakdown,
    getQuotaValue,
    countStorageNodesByMirrorSet
} from 'utils/bucket-utils';

const rawUsageTooltip = deepFreeze({
    text: 'Raw usage refers to the actual size this bucket is utilizing from it\'s resources including data resiliency replicas or fragments',
    align: 'end'
});

const dataUsageTooltip = deepFreeze({
    text: 'Data optimization consist of deduplication and compression',
    align: 'end'
});

function _mapModeToStateTooltip(bucket, dataBreakdown, hostPools) {
    switch (bucket.mode) {
        case 'NO_RESOURCES': {
            return 'This bucket is not connected to any resources that can be utilized. Add resources via bucket data placement policy';
        }
        case 'NOT_ENOUGH_HEALTHY_RESOURCES': {
            // TODO: x of x resources...
            return 'Some resources are not healthy and the bucket data allocation cannot be completed. Try fixing problematic resources or change the bucket’s placement policy.';
        }
        case 'NOT_ENOUGH_RESOURCES': {
            const { kind, replicas, dataFrags, parityFrags } = bucket.resiliency;
            const policyText =
                (kind === 'REPLICATION' && `replication of ${replicas} copies`) ||
                (kind === 'ERASURE_CODING' && `erasure coding of ${dataFrags}+${parityFrags}`) ||
                'an unknown policy';

            const requiredDrives =
                (kind === 'REPLICATION' && replicas) ||
                (kind === 'ERASURE_CODING' && (dataFrags + parityFrags)) ||
                NaN;

            const storageNodesPerMirrorSet = countStorageNodesByMirrorSet(bucket.placement, hostPools);
            const missingNodesForResiliency = sumBy(
                storageNodesPerMirrorSet,
                count => Math.max(0, requiredDrives - count)
            );

            return `The bucket’s configured data resiliency is set to ${policyText}. In order to meet that requirement, add at least ${missingNodesForResiliency} more drives to the nodes pool or add a cloud resource to placement policy`;
        }
        case 'NO_CAPACITY': {
            return 'This bucket has no more available storage. In order to enable data writes, add more resources to the bucket data placement policy';
        }
        case 'EXCEEDING_QUOTA': {
            return 'This bucket data writes reached the configured limit. Change the bucket quota configurations to enable new writes';
        }
        case 'LOW_CAPACITY': {
            const available = formatSize(dataBreakdown.availableForUpload);
            return `The currently size available for uploads is ${available}, try adding more resources or change the bucket policies`;
        }
        case 'RISKY_TOLERANCE': {
            return 'According to the configured data resiliency policy, only 1 node/drive can fail before all stored data will no longer be able to recover. It’s recommended to add more nodes to the nodes pools and distribute drives over the different nodes';
        }
        case 'NO_RESOURCES_INTERNAL': {
            return 'Bucket doesn\’t have any connected resources in it’s tier. Currently the system is using the internal VM disk capacity to store data which is not recommended. Add   resources to the bucket’s tier placement policy.';
        }
        case 'APPROUCHING_QUOTA': {
            const quota = formatSize(getQuotaValue(bucket.quota));
            const used = formatSize(dataBreakdown.used);
            const available = formatSize(dataBreakdown.availableForUpload);
            return `Bucket utilization is ${used} out of ${quota}. Please change the configured limit if you wish to write more then ${available} this bucket`;
        }
        case 'DATA_ACTIVITY': {
            return 'Currently restoring/migrating/deleting data according to the latest change that was made in the bucket policy. The process might take a while';
        }
        case 'MANY_TIERS_ISSUES': {
            return 'Some resources in the bucket’s tiers have issues. Review tiering section and try to fix problematic resources or edit the tiers placement policy.';
        }
        case 'ONE_TIER_ISSUES': {
            const i = bucket.placement.tiers.findIndex(tier =>
                tier.mode !== 'OPTIMAL'
            ) + 1;
            return `Some resources in tier ${i} have issues. Review tier’s ${i} section and try to fix problematic resources or edit the tier’s placement policy.`;
        }
        case 'OPTIMAL': {
            return 'Bucket is operating as expected according to it’s configured bucket policies';
        }
    }
}

function _getDataPlacementText(placement) {
    const { tiers } = placement;
    const resources = flatMap(tiers, tier =>
        flatMap(tier.mirrorSets || [], ms =>
            ms.resources
        )
    );

    return `${
        stringifyAmount('tier', tiers.length)
    }, ${
        stringifyAmount('resource', resources.length)
    }`;
}

function _getQuotaMarkers(quota) {
    if (!quota) return [];

    const value = getQuotaValue(quota);
    const placement = toBytes(value);
    const label = `Quota: ${formatSize(value)}`;
    return [{ placement, label }];
}

function _formatAvailablityLimits(val) {
    return val === 0 ? '0' : formatSize(val);
}

function _getBucketStateInfo(bucket, dataBreakdown, hostPools) {
    const { name, css, tooltip: text } = getBucketStateIcon(bucket);
    const tooltip = _mapModeToStateTooltip(bucket, dataBreakdown, hostPools);
    return {
        icon: {
            name,
            css,
            tooltip: {
                text: tooltip,
                align: 'start'
            }
        },
        text
    };
}

class BucketSummrayViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    state = ko.observable();
    dataPlacement = ko.observable();
    availablityLimitsFormatter = _formatAvailablityLimits;
    availablityMarkers = ko.observableArray();
    availablityTime = ko.observable();
    availablity = [
        {
            label: 'Used Data',
            color: style['color8'],
            value: ko.observable(),
            tooltip: 'The total amount of data uploaded to this bucket. does not include data optimization or data resiliency'
        },
        {
            label: 'Overused',
            color: style['color10'],
            value: ko.observable(),
            visible: ko.observable(),
            tooltip: 'Data that was written and exceeded the bucket configured quota'
        },
        {
            label: 'Available According to Policies',
            color: style['color15'],
            value: ko.observable(),
            tooltip: 'The actual free space on this bucket for data writes taking into account the current configured bucket policies'
        },
        {
            label: 'Available on Internal Storage',
            color: style['color18'],
            value: ko.observable(),
            visible: ko.observable(),
            tooltip: 'The current available storage from the system internal storage resource, will be used only in the case of no available data storage on this bucket. Once possible, data will be spilled-back'
        },
        {
            label: 'Overallocated',
            color: style['color11'],
            value: ko.observable(),
            visible: ko.observable(),
            tooltip: 'Overallocation happens when configuring a higher quota than this bucket assigned resources can store'
        }
    ];
    dataOptimization = ko.observable();
    dataUsageTooltip = dataUsageTooltip;
    dataUsage = [
        {
            label: 'Original Data Size',
            color: style['color7'],
            value: ko.observable()
        },
        {
            label: 'After Optimizations',
            color: style['color13'],
            value: ko.observable()
        }
    ];
    dataUsageChart = {
        width: 60,
        height: 60,
        draw: this.onDrawBars.bind(this),
        disabled: ko.observable(),
        bars: this.dataUsage.map(item => ({
            color: item.color,
            height: ko.observable(),
            animate: ko.observable()
                .extend({ tween: { delay: 350 } })
        })),
        tooltip: {
            maxWidth: 280,
            template: chartTooltipTemplate,
            text: {
                updateTime: ko.observable(),
                values: this.dataUsage
            }
        }
    };
    rawUsageLabel = ko.observable();
    rawUsageTooltip = rawUsageTooltip;
    rawUsage = [
        {
            label: 'Available from Resources',
            color: style['color5'],
            value: ko.observable()
        },
        {
            label: 'Raw Usage',
            color: style['color13'],
            value: ko.observable()
        },
        {
            label: 'Shared Resources Usage',
            color: style['color14'],
            value: ko.observable()
        }
    ];
    rawUsageChart = {
        values: this.rawUsage,
        silhouetteColor: ko.observable(),
        disabled: ko.observable(),
        tooltip: {
            maxWidth: 280,
            template: chartTooltipTemplate,
            text: {
                caption: ko.observable(),
                updateTime: ko.observable(),
                values: this.rawUsage
            }
        }
    };

    selectState(state, params) {
        return [
            state.buckets && state.buckets[params.bucketName],
            state.hostPools
        ];
    }

    mapStateToProps(bucket, hostPools) {
        if (!bucket) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { quota, placement } = bucket;
            const storage = mapValues(bucket.storage, toBytes);
            const usingInternalStorage = placement.tiers[0].policyType === 'INTERNAL_STORAGE';
            const data = mapValues(bucket.data, toBytes);
            const dataBreakdown = mapValues(getDataBreakdown(data, quota), toBytes);
            const rawUsageLabel = storage.used ? formatSize(storage.used) : 'No Usage';
            const rawUsageTooltipCaption = `Total Raw Storage: ${formatSize(storage.total)}`;
            const dataLastUpdateTime = moment(storage.lastUpdate).fromNow();
            const storageLastUpdateTime = moment(data.lastUpdate).fromNow();
            const hasSize = data.size > 0;
            const reducedRatio = hasSize ? data.sizeReduced / data.size : 0;
            const dataOptimization = hasSize ? numeral(1 - reducedRatio).format('%') : 'No Data';

            ko.assignToProps(this, {
                dataReady: true,
                state: _getBucketStateInfo(bucket, dataBreakdown, hostPools),
                dataPlacement: _getDataPlacementText(placement),
                availablity: [
                    {
                        value: dataBreakdown.used
                    },
                    {
                        value: dataBreakdown.overused,
                        visible: !isSizeZero(dataBreakdown.overused)
                    },
                    {
                        value: !usingInternalStorage ?
                            dataBreakdown.availableForUpload :
                            0
                    },
                    {
                        value: usingInternalStorage ?
                            dataBreakdown.availableForUpload :
                            0,
                        visible: usingInternalStorage
                    },
                    {
                        value: dataBreakdown.overallocated,
                        visible: !isSizeZero(dataBreakdown.overallocated)
                    }
                ],
                availablityMarkers: _getQuotaMarkers(quota),
                availablityTime: dataLastUpdateTime,
                dataOptimization: dataOptimization,
                dataUsage: [
                    { value: data.size },
                    { value: data.sizeReduced }
                ],
                dataUsageChart: {
                    disabled: !hasSize,
                    bars: [
                        {
                            height: 1,
                            aniamte: hasSize
                        },
                        {
                            height: hasSize ? reducedRatio : 1,
                            animate: hasSize
                        }
                    ],
                    tooltip: {
                        text: {
                            updateTime: dataLastUpdateTime
                        }
                    }
                },
                rawUsage: [
                    { value: storage.free },
                    { value: storage.used },
                    { value: storage.usedOther }
                ],
                rawUsageLabel: rawUsageLabel,
                rawUsageChart: {
                    disabled: storage.total === 0,
                    silhouetteColor: storage.total === 0 ? style['color7'] : undefined,
                    tooltip: {
                        text: {
                            caption: rawUsageTooltipCaption,
                            updateTime: storageLastUpdateTime
                        }
                    }
                }
            });
        }
    }

    onDrawBars(ctx, size) {
        if (!this.dataReady()) return;

        const barWidth = 16;
        const { width, height: scale } = size;
        const { bars } = this.dataUsageChart;
        const spacing = (width - bars.length * barWidth) / (bars.length + 1);

        bars.reduce(
            (offset, bar) => {
                const { color, height } = bar;
                ctx.fillStyle = color;
                ctx.fillRect(offset, (1 - height()) * scale, barWidth, height() * scale);
                return offset + barWidth + spacing;
            },
            spacing
        );
    }
}

export default {
    viewModel: BucketSummrayViewModel,
    template: template
};
