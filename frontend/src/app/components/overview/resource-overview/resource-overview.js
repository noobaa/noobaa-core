/* Copyright (C) 2016 NooBaa */

import template from './resource-overview.html';
import poolsTemplate from './pools.html';
import cloudTemplate from './cloud.html';
import internalTemplate from './internal.html';
import Observer from 'observer';
import style from 'style';
import { routeContext } from 'model';
import ko from 'knockout';
import { redirectTo } from 'actions';
import { deepFreeze } from 'utils/core-utils';
import { stringifyAmount} from 'utils/string-utils';
import { formatSize } from 'utils/size-utils';
import { hexToRgb } from 'utils/color-utils';
import { openInstallNodesModal, openAddCloudResrouceModal } from 'dispatchers';
import { aggregateStorage } from 'utils/storage-utils';
import { countNodesByState } from 'utils/ui-utils';
import { state$ } from 'state';

const AWS = 'AWS';
const AZURE = 'AZURE';
const S3_COMPATIBLE = 'S3_COMPATIBLE';

const resourceTypeOptions = deepFreeze([
    {
        label: 'Pools',
        value: 'pools'
    },
    {
        label: 'Cloud',
        value: 'cloud'
    },
    {
        label : 'Internal',
        value: 'internal'
    }
]);

const tooltips = deepFreeze({
    pools:    `This number is calculated from the total capacity of all 
               installed nodes in the system regardless to current usage or availability.`,
    cloud:    `This number is an estimated aggregation of all public cloud resources connected to the system. 
               Any cloud resource is define as 1PB of raw storage.`,
    internal: `Internal storage is a resource which resides on the local VM’s disks.  
               It can only be used for spilled-over data from buckets. 
               This number represents the amount of total internal storage in the system.`

});

class ResourceOverviewViewModel extends Observer {
    constructor() {
        super();

        const query = ko.pureComputed(
            () => routeContext().query || {}
        );

        this.resourceTypeOptions = resourceTypeOptions;
        this.tooltips = tooltips;
        this.selectedResourceType = ko.pureComputed({
            read: () => query().resourceType || resourceTypeOptions[0].value,
            write: value => this.selectResourceType(value)
        });
        this.poolsOverviewTemplate = poolsTemplate;
        this.cloudOverviewTemplate = cloudTemplate;
        this.internalOverviewTemplate = internalTemplate;

        this.poolsCount = ko.observable();
        this.cloudCount = ko.observable();
        this.internalResourceState = ko.observable();
        this.cloudStorage = ko.observable();
        this.internalStorage = ko.observable();
        this.nodesStorage = ko.observable();
        this.nodeCount = ko.observable();
        this.nodeCountText = ko.observable();
        this.cloudCount = ko.observable();
        this.cloudCountText = ko.observable();
        this.cloudCountSecondaryText = ko.observable();
        this.poolsCount = ko.observable();
        this.resourcesLinkText = ko.observable();

        this.poolsChartValues = [
            {
                label: 'Online',
                value: ko.observable(),
                color: hexToRgb(style['color12'])
            },
            {
                label: 'Has issues',
                value: ko.observable(),
                color: hexToRgb(style['color11'])
            },
            {
                label: 'Offline',
                value: ko.observable(),
                color: hexToRgb(style['color10'])
            }
        ];

        this.cloudChartValues = [
            {
                label: 'AWS S3',
                value: ko.observable(),
                icon: 'aws-s3-resource',
                color: hexToRgb(style['color8'])
            },
            {
                label: 'Azure blob',
                value: ko.observable(),
                icon: 'azure-resource',
                color: hexToRgb(style['color7'])
            },
            {
                label: 'S3 compatible',
                value: ko.observable(),
                icon: 'cloud-resource',
                color: hexToRgb(style['color16'])
            }
        ];

        this.internalChartValues = [
            {
                label: 'Available',
                value: ko.observable(0),
                color: hexToRgb(style['color5'])
            },
            {
                label: 'Used (Spilled over from buckets)',
                value: ko.observable(0),
                color: hexToRgb(style['color13'])
            }
        ];

        this.observe(state$.get('nodePools'), this.onPools);
        this.observe(state$.get('cloudResources'), this.onCloud);
        this.observe(state$.get('internalResources'), this.onInternal);
        this.observe(state$.get('buckets'), this.onBucket);
    }

    onPools(nodePools) {
        const poolList = Object.values(nodePools.pools);
        const nodesByMode = countNodesByState(nodePools.nodes);
        const healthyCount = nodesByMode.healthy || 0;
        const withIssuesCount = nodesByMode.hasIssues || 0;
        const offlineCount = nodesByMode.offline || 0;
        const count = healthyCount + withIssuesCount + offlineCount;

        this.nodeCount(count);
        this.poolsCount(poolList.length);
        this.poolsCount(poolList.length);
        this.poolsChartValues[0].value(healthyCount);
        this.poolsChartValues[1].value(withIssuesCount);
        this.poolsChartValues[2].value(offlineCount);
        const poolsStorageList = poolList.map(cloud => cloud.storage);
        this.nodesStorage(poolsStorageList.length ? formatSize(aggregateStorage(...poolsStorageList).total) : 0);
        this.nodeCountText(stringifyAmount('Node', this.nodeCount()));
        this.resourcesLinkText(stringifyAmount(
            'Resource',
            this.poolsCount() + this.cloudCount(),
            'No'
        ));
    }

    onCloud(cloudResources) {
        const cloudResourcesList = Object.values(cloudResources);
        this.cloudCount(cloudResourcesList.length);
        const awsCount = cloudResourcesList.filter( cloud => cloud.type === AWS).length;
        const azureCount = cloudResourcesList.filter( cloud => cloud.type === AZURE).length;
        const s3CompatibleCount = cloudResourcesList.filter( cloud => cloud.type === S3_COMPATIBLE).length;

        this.cloudCount(cloudResourcesList.length);
        this.cloudChartValues[0].value(awsCount);
        this.cloudChartValues[1].value(azureCount);
        this.cloudChartValues[2].value(s3CompatibleCount);
        const cloudStorageList = cloudResourcesList.map(cloud => cloud.storage);
        this.cloudStorage(cloudStorageList.length ? aggregateStorage(...cloudStorageList).total.peta : 0);
        this.cloudCountText(`${this.cloudCount()} Cloud`);
        this.cloudCountSecondaryText(this.cloudCount() === 1 ? 'resource' : 'resources');
    }

    onInternal(internalResources) {
        const internalResourcesList = Object.values(internalResources);

        if(internalResourcesList.length) {
            const internalResource = internalResourcesList[0];

            this.internalChartValues[0].value(internalResource.storage.free);
            this.internalChartValues[1].value(internalResource.storage.used);

            this.internalStorage(formatSize(internalResource.storage.total));
        }
    }

    onBucket(buckets) {
        const bucketsList = Object.values(buckets);
        const spilloverEnabled = bucketsList.filter(bucket => bucket.spilloverEnabled).length;
        this.internalResourceState( spilloverEnabled ? 'Enabled' : 'Disabled');
    }

    onInstallNodes() {
        openInstallNodesModal();
    }

    onAddCloudResource() {
        openAddCloudResrouceModal();
    }

    selectResourceType(type) {
        const resourceType = type || undefined;
        const filter = undefined;
        redirectTo(undefined, undefined, { filter, ...routeContext().query, resourceType });
    }

    isVisible(resourceType) {
        return this.selectedResourceType() === resourceType;
    }

}

export default {
    viewModel: ResourceOverviewViewModel,
    template: template
};
