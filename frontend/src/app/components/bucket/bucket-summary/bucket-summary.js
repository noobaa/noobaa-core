/* Copyright (C) 2016 NooBaa */

import template from './bucket-summary.html';
import chartTooltipTemplate from './chart-tooltip.html';
import ConnectableViewModel from 'components/connectable';
import { deepFreeze, flatMap, mapValues, sumBy } from 'utils/core-utils';
import { stringifyAmount } from 'utils/string-utils';
import { isSizeZero, formatSize, toBytes, sumSize } from 'utils/size-utils';
import ko from 'knockout';
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

function _summrizeResiliencyPolicy(resiliency) {
    const { kind, replicas, dataFrags, parityFrags } = resiliency;
    const desc =
        (kind === 'REPLICATION' && `replication of ${replicas} copies`) ||
        (kind === 'ERASURE_CODING' && `erasure coding of ${dataFrags}+${parityFrags}`) ||
        'an unknown policy';
    const driveCount =
        (kind === 'REPLICATION' && replicas) ||
        (kind === 'ERASURE_CODING' && (dataFrags + parityFrags)) ||
        NaN;

    return { desc, driveCount };
}

function _mapModeToStateTooltip(bucket, dataBreakdown, hostPools, cloudResources) {
    const { tiers } = bucket.placement;

    switch (bucket.mode) {
        case 'NO_RESOURCES': {
            return 'This bucket is not connected to any resources that can be utilized. Add resources via bucket data placement policy';
        }
        case 'NOT_ENOUGH_RESOURCES': {
            const { desc, driveCount } = _summrizeResiliencyPolicy(bucket.resiliency);
            return `The bucket’s configured data resiliency is set to ${desc} In order to meet that requirement, each tier must have at least ${driveCount} in their pools or a cloud resource in it\'s placement policy`;
        }
        case 'NOT_ENOUGH_HEALTHY_RESOURCES': {
            return 'Some resources are not healthy and the bucket data allocation cannot be completed. Try fixing problematic resources or change the bucket’s placement policy.';
        }
        case 'NO_CAPACITY': {
            return 'This bucket has no more available storage. In order to enable data writes, add more resources to the bucket data placement policy';
        }
        case 'ALL_TIERS_HAVE_ISSUES': {
            return 'The bucket’s tiering structure is suffering from various issues. Try fixing problematic resources or change the tiers placement policy';
        }
        case 'EXCEEDING_QUOTA': {
            return 'This bucket data writes reached the configured limit. Change the bucket quota configurations to enable new writes';
        }
        case 'TIER_NO_RESOURCES': {
            const i = tiers.findIndex(tier => tier.mode === 'NO_RESOURCES');
            return `Tier ${i + 1} is not connected to any resources that can be utilized. Add resources via Edit tier ${i + 1} resources.`;
        }
        case 'TIER_NOT_ENOUGH_RESOURCES': {
            const tier = tiers.find(tier => tier.mode === 'NOT_ENOUGH_RESOURCES');
            const { desc, driveCount } = _summrizeResiliencyPolicy(bucket.resiliency);
            const storageNodesPerMirrorSet = countStorageNodesByMirrorSet(tier, hostPools);
            const missingNodes = sumBy(
                storageNodesPerMirrorSet,
                count => Math.max(0, driveCount - count)
            );

            return `The bucket's configured data resiliency is set to ${desc}. In order to meet that requirement, add at least ${missingNodes} more drives to the nodes pool or add a cloud resource to the tier's placement policy`;
        }
        case 'TIER_NOT_ENOUGH_HEALTHY_RESOURCES': {
            const i = tiers.findIndex(tier => tier.mode === 'NOT_ENOUGH_HEALTHY_RESOURCES');
            return `Some resources are not healthy and the data allocation cannot be completed. Try fixing problematic resources or change tier ${i+1} resources policy.`;
        }
        case 'TIER_NO_CAPACITY': {
            const i = tiers.findIndex(tier => tier.mode === 'NO_CAPACITY');
            return `Tier ${i + 1} has no more available storage. In order to enable data writes and maintain the tier data structure, add more resources to the tier resources policy`;
        }
        case 'LOW_CAPACITY': {
            const available = formatSize(dataBreakdown.availableForUpload);
            return `The currently size available for uploads is ${available}, try adding more resources or change the bucket policies`;
        }
        case 'TIER_LOW_CAPACITY': {
            const i = tiers.findIndex(tier => tier.mode === 'LOW_CAPACITY');
            const availableSize = flatMap(tiers[i].mirrorSets || [], ms => ms.resources)
                .reduce((size, { type, name }) => {
                    const coll = type === 'HOSTS' ? hostPools : cloudResources;
                    const { free = 0, unavailableFree = 0 } = coll[name];
                    return sumSize(size, free, unavailableFree);
                }, 0);
            const available = formatSize(availableSize);

            return `Tier ${i + 1} current available capacity is only ${available}. If you wish to continue writing to this tier, try adding more resources or change the bucket policies `;
        }
        case 'NO_RESOURCES_INTERNAL': {
            return 'Bucket doesn\’t have any connected resources in it’s tier. Currently the system is using the internal VM disk capacity to store data which is not recommended. Add resources to the bucket’s tier placement policy.';
        }
        case 'RISKY_TOLERANCE': {
            return 'According to the configured data resiliency policy, only 1 node/drive can fail before all stored data will no longer be able to recover. It’s recommended to add more nodes to the pools and distribute drives over the different nodes';
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

function _getBucketStateInfo(bucket, dataBreakdown, hostPools, cloudResources) {
    const { name, css, tooltip: { text } } = getBucketStateIcon(bucket);
    const tooltip = _mapModeToStateTooltip(bucket, dataBreakdown, hostPools, cloudResources);
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
    availablityTime = ko.observable();
    availablityBar = {
        format: ko.observable(),
        values: [
            {
                label: 'Used Data',
                color: 'rgb(var(--color6))',
                value: ko.observable(0),
                tooltip: 'The total amount of data uploaded to this bucket. does not include data optimization or data resiliency'
            },
            {
                label: 'Available According to Policies',
                color: 'rgb(var(--color16))',
                value: ko.observable(0),
                tooltip: 'The actual free space on this bucket for data writes taking into account the current configured bucket policies'
            },
            {
                label: 'Available on Internal Storage',
                color: 'rgb(var(--color8))',
                value: ko.observable(0),
                visible: ko.observable(),
                tooltip: 'The current available storage from the system internal storage disks, will be used only in the case of no available storage resources on this bucket.'
            },
            {
                label: 'Overallocated',
                color: 'rgb(var(--color19))',
                value: ko.observable(0),
                visible: ko.observable(),
                tooltip: 'Overallocation happens when configuring a higher quota than this bucket assigned resources can store'
            },
            {
                label: 'Overused',
                color: 'rgb(var(--color20))',
                value: ko.observable(0),
                visible: ko.observable(),
                tooltip: 'Data that was written and exceeded the bucket configured quota'
            }
        ],
        markers: [
            {
                visible: ko.observable(),
                text: ko.observable(),
                position: 4
            }
        ]
    };
    dataOptimization = ko.observable();
    dataUsageTooltip = dataUsageTooltip;
    dataUsage = [
        {
            label: 'Original Data Size',
            color: 'rgb(var(--color10))',
            value: ko.observable()
        },
        {
            label: 'After Optimizations',
            color: 'rgb(var(--color6))',
            value: ko.observable()
        }
    ];
    dataUsageChart = {
        draw: this.onDrawBars.bind(this),
        disabled: ko.observable(),
        bars: this.dataUsage.map((item, i) => ({
            x: 1/9 * (1 + 4 * i),
            y: ko.observable(),
            width: 1/3,
            height: ko.observable(),
            fill: item.color
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
    rawUsageValues = [
        {
            label: 'Available from Resources',
            color: 'rgb(var(--color26))',
            value: ko.observable(0)
        },
        {
            label: 'Raw Usage',
            color: 'rgb(var(--color6))',
            value: ko.observable(0)
        },
        {
            label: 'Shared Resources Usage',
            color: 'rgb(var(--color7))',
            value: ko.observable(0)
        }
    ];
    rawUsageChart = {
        values: this.rawUsageValues,
        silhouetteColor: ko.observable(),
        disabled: ko.observable(),
        tooltip: {
            maxWidth: 280,
            template: chartTooltipTemplate,
            text: {
                caption: ko.observable(),
                updateTime: ko.observable(),
                values: this.rawUsageValues
            }
        }
    };

    selectState(state, params) {
        return [
            state.buckets && state.buckets[params.bucketName],
            state.hostPools,
            state.cloudResources
        ];
    }

    mapStateToProps(bucket, hostPools, cloudResources) {
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
            const reducedRatio = hasSize ? Math.min(data.sizeReduced / data.size, 1) : 0;
            const dataOptimization = hasSize ? numeral(1 - reducedRatio).format('%') : 'No Data';
            const storageUsed = storage.used + storage.usedOther;
            const isInOveruse = toBytes(dataBreakdown.overused) > 0;

            ko.assignToProps(this, {
                dataReady: true,
                state: _getBucketStateInfo(bucket, dataBreakdown, hostPools, cloudResources),
                dataPlacement: _getDataPlacementText(placement),
                availablityBar: {
                    format: val => (
                        (val === 0 && '0') ||
                        (quota && !isInOveruse && `Quota: ${formatSize(val)}`) ||
                        formatSize(val)
                    ),
                    values: [
                        {
                            value: dataBreakdown.used
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
                        },
                        {
                            value: dataBreakdown.overused,
                            visible: !isSizeZero(dataBreakdown.overused)
                        }
                    ],
                    markers: [
                        {
                            visible: Boolean(quota) && isInOveruse,
                            text: quota ?
                                `Quota: ${formatSize(getQuotaValue(quota))}` :
                                ''
                        }
                    ]
                },
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
                            y: 0,
                            height: 1
                        },
                        {
                            y: hasSize ? (1 - reducedRatio) : 0,
                            height: hasSize ? reducedRatio : 1
                        }
                    ],
                    tooltip: {
                        text: {
                            updateTime: dataLastUpdateTime
                        }
                    }
                },
                rawUsageLabel: rawUsageLabel,
                rawUsageValues: [
                    { value: storage.free },
                    { value: storage.used },
                    { value: storage.usedOther }
                ],
                rawUsageChart: {
                    disabled: storageUsed === 0,
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
