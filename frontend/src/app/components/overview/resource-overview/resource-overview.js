/* Copyright (C) 2016 NooBaa */

import template from './resource-overview.html';
import BaseViewModel from 'components/base-view-model';
import style from 'style';
import { systemInfo } from 'model';
import ko from 'knockout';
import { deepFreeze, keyBy } from 'utils/core-utils';
import { stringifyAmount} from 'utils/string-utils';
import { countNodesByState } from 'utils/ui-utils';
import { toBytes } from 'utils/size-utils';
import { hexToRgb } from 'utils/color-utils';
import { action$ } from 'state';
import { openInstallNodesModal } from 'action-creators';

const allCounters = deepFreeze({
    ALL: 0,
    NODES_POOL: 0,
    AWS: 0,
    AZURE: 0,
    S3_COMPATIBLE: 0
});

const pieColorsOpacityFactor = .5;

class ResourceOverviewViewModel extends BaseViewModel {
    constructor() {
        super();

        const resourceCounters = ko.pureComputed(
            () => {
                const relevantPools = (systemInfo() ? systemInfo().pools : [])
                    .filter(({ resource_type }) => resource_type === 'HOSTS' || resource_type === 'CLOUD');

                const counters = keyBy(
                    relevantPools,
                    pool => pool.resource_type === 'CLOUD' ? pool.cloud_info.endpoint_type : 'NODES_POOL',
                    (_, counter) => (counter || 0) + 1
                );

                return {
                    ...allCounters,
                    ...counters,
                    ALL: relevantPools.length
                };
            }
        );

        this.resourceCount = ko.pureComputed(
            () => resourceCounters().ALL
        );

        this.resourcesLinkText = ko.pureComputed(
            () => stringifyAmount(
                'Resource',
                resourceCounters()['ALL'],
                'No'
            )
        );

        this.nodePoolsCount = ko.pureComputed(
            () => resourceCounters().NODES_POOL
        );

        this.awsResourceIcon = ko.pureComputed(
            () => resourceCounters().AWS === 0 ?
                'aws-s3-resource' :
                'aws-s3-resource-colored'
        );

        this.awsResourceCount = ko.pureComputed(
            () => resourceCounters().AWS
        );

        this.azureResourceIcon = ko.pureComputed(
            () => resourceCounters().AZURE === 0 ?
                'azure-resource' :
                'azure-resource-colored'
        );

        this.azureResourceCount = ko.pureComputed(
            () => resourceCounters().AZURE
        );

        this.genericResourceIcon = ko.pureComputed(
            () => resourceCounters().S3_COMPATIBLE === 0 ?
                'cloud-resource' :
                'cloud-resource-colored'
        );

        this.genericResourceCount = ko.pureComputed(
            () => resourceCounters().S3_COMPATIBLE
        );
        const nodeCounters = ko.pureComputed(
            () => countNodesByState(systemInfo() ? systemInfo().hosts.by_mode : {})
        );

        const healthyNodesCount = ko.pureComputed(
            () => nodeCounters().healthy
        );

        const offlineNodesCount = ko.pureComputed(
            () => nodeCounters().offline
        );

        const nodesWithIssuesCount = ko.pureComputed(
            () => nodeCounters().hasIssues
        );

        this.chartValues = [
            {
                label: 'Healthy',
                value: healthyNodesCount,
                color: hexToRgb(style['color12'], pieColorsOpacityFactor)
            },
            {
                label: 'Has issues',
                value: nodesWithIssuesCount,
                color: hexToRgb(style['color11'], pieColorsOpacityFactor)
            },
            {
                label: 'Offline',
                value: offlineNodesCount,
                color: hexToRgb(style['color10'], pieColorsOpacityFactor)
            }
        ];

        this.systemCapacity = ko.pureComputed(
            () => toBytes(systemInfo() ? systemInfo().nodes_storage.total : 0)
        )
        .extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatSize: true
        });

        const nodeCount = ko.pureComputed(
            () => systemInfo() ? systemInfo().hosts.count : 0
        ).extend({
            tween: { useDiscreteValues: true, resetValue: 0 },
            formatNumber: true
        });

        this.nodeCountText = ko.pureComputed(
            () => `${nodeCount()} Nodes`
        );
    }

    onInstallNodes() {
        action$.onNext(openInstallNodesModal());
    }
}

export default {
    viewModel: ResourceOverviewViewModel,
    template: template
};
