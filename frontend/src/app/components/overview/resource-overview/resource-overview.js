/* Copyright (C) 2016 NooBaa */

import template from './resource-overview.html';
import poolsOverviewTemplate from './pools.html';
import cloudOverviewTemplate from './cloud.html';
import internalOverviewTemplate from './internal.html';
import Observer from 'observer';
import style from 'style';
import { routeContext } from 'model';
import ko from 'knockout';
import { redirectTo } from 'actions';
import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount} from 'utils/string-utils';
import { formatSize } from 'utils/size-utils';
import { hexToRgb } from 'utils/color-utils';
import { openInstallNodesModal } from 'dispatchers';
import { aggregateStorage } from 'utils/storage-utils';
import { state$ } from 'state';

const cloudTypes = deepFreeze({
    AWS: 'AWS',
    AZURE: 'AZURE',
    S3_COMPATIBLE: 'S3_COMPATIBLE'
});

const pieColorsOpacityFactor = deepFreeze({
    pools: .5,
    cloud: .8,
    internal: .4
});

const resourceTypeOptions = deepFreeze([
    {
        label: 'Pools',
        value: 'pools'
    },
    {
        label: 'Cloud',
        value: 'cloud',
    },
    {
        label : 'Internal',
        value: 'internal'
    }
]);

class ResourceOverviewViewModel extends Observer {
    constructor() {
        super();

        const query = ko.pureComputed(
            () => routeContext().query || {}
        );

        this.resourceTypeOptions = resourceTypeOptions;
        this.selectedResourceType = ko.pureComputed({
            read: () => query().resourceType || resourceTypeOptions[0].value,
            write: value => this.selectResourceType(value)
        });
        this.poolsOverviewTemplate = poolsOverviewTemplate;
        this.cloudOverviewTemplate = cloudOverviewTemplate;
        this.internalOverviewTemplate = internalOverviewTemplate;

        this.poolsChartLegend = ko.observable('');
        this.cloudChartLegend = ko.observable('');
        this.internalChartLegend = ko.observable('');
        this.cloudStorage = ko.observable('');

        this.poolsChartValues = [
            {
                label: 'Online',
                value: ko.observable(0),
                color: hexToRgb(style['color12'], pieColorsOpacityFactor.pools)
            },
            {
                label: 'Has issues',
                value: ko.observable(0),
                color: hexToRgb(style['color11'], pieColorsOpacityFactor.pools)
            },
            {
                label: 'Offline',
                value: ko.observable(0),
                color: hexToRgb(style['color10'], pieColorsOpacityFactor.pools)
            }
        ];

        this.cloudChartValues = [
            {
                label: 'AWS S3',
                value: ko.observable(0),
                icon: ko.observable('aws-s3-resource'),
                color: hexToRgb(style['color8'], pieColorsOpacityFactor.cloud)
            },
            {
                label: 'Azure blob',
                value: ko.observable(0),
                icon: ko.observable('azure-resource'),
                color: hexToRgb(style['color6'], pieColorsOpacityFactor.cloud)
            },
            {
                label: 'S3 compatible',
                value: ko.observable(0),
                icon: ko.observable('cloud-resource'),
                color: hexToRgb(style['color16'], pieColorsOpacityFactor.cloud)
            }
        ];

        this.internalChartValues = [
            {
                label: 'Available',
                value: ko.observable(0),
                color: hexToRgb(style['color8'], pieColorsOpacityFactor.internal)
            },
            {
                label: 'Used (Spilled over from buckets)',
                value: ko.observable(0),
                color: hexToRgb(style['color6'], pieColorsOpacityFactor.internal)
            }
        ];

        this.systemCapacity = ko.observable(0);
        this.nodeCount = ko.observable(0);
        this.nodeCountText = ko.pureComputed(
            () => stringifyAmount('Nodes', this.nodeCount())
        );

        this.cloudCount = ko.observable(0);
        this.cloudCountText = ko.pureComputed(
            () => `${this.cloudCount()} Cloud`
        );

        this.cloudCountSecondaryText = ko.pureComputed(
            () => this.cloudCount() === 1 ? 'resource' : 'resources'
        );

        this.poolsCount = ko.observable(0);
        this.resourcesLinkText = ko.pureComputed(
            () => stringifyAmount(
                'Resource',
                this.poolsCount() + this.cloudCount(),
                'No'
            )
        );

        this.observe(state$.get('nodePools'), this.onPools);
        this.observe(state$.get('cloudResources'), this.onCloud);
    }

    onPools(nodePools) {
        const poolList = Object.values(nodePools.pools);
        const nodes = nodePools.nodes;

        const healthyCount = nodes.healthyCount ? nodes.healthyCount : 0;
        const withIssuesCount = nodes.withIssuesCount ? nodes.withIssuesCount : 0;
        const offlineCount = nodes.offlineCount ? nodes.offlineCount : 0;
        const count = healthyCount + withIssuesCount + offlineCount;

        this.nodeCount(count);
        this.poolsCount(poolList.length);
        this.poolsChartLegend(`Pools: ${poolList.length} | Nodes in Pools:`);
        this.poolsChartValues[0].value(healthyCount);
        this.poolsChartValues[1].value(withIssuesCount);
        this.poolsChartValues[2].value(offlineCount);
        const poolsStorageList = poolList.map(cloud => cloud.storage);
        this.systemCapacity(poolsStorageList.length ? formatSize(aggregateStorage(...poolsStorageList).total) : 0);
    }

    onCloud(cloudResources) {
        const cloudResourcesList = Object.values(cloudResources);

        this.cloudChartLegend(`Cloud storage: ${cloudResourcesList.length} | Services:`);

        const awsCount = cloudResourcesList.filter( cloud => cloud.type === cloudTypes.AWS).length;
        const azureCount = cloudResourcesList.filter( cloud => cloud.type === cloudTypes.AZURE).length;
        const s3CompatibleCount = cloudResourcesList.filter( cloud => cloud.type === cloudTypes.S3_COMPATIBLE).length;

        this.cloudCount(cloudResourcesList.length);
        this.cloudChartValues[0].value(awsCount);
        this.cloudChartValues[1].value(azureCount);
        this.cloudChartValues[2].value(s3CompatibleCount);
        const cloudStorageList = cloudResourcesList.map(cloud => cloud.storage);
        this.cloudStorage(cloudStorageList.length ? aggregateStorage(...cloudStorageList).total.peta : 0);
    }

    onInstallNodes() {
        openInstallNodesModal();
    }

    selectResourceType(type) {
        const resourceType = type || undefined;
        const filter = undefined;
        redirectTo(undefined, undefined, { filter, resourceType });
    }

    isVisible(resourceType) {
        return this.selectedResourceType() === resourceType;
    }

}

export default {
    viewModel: ResourceOverviewViewModel,
    template: template
};
