/* Copyright (C) 2016 NooBaa */

import template from './resource-overview.html';
import poolsTemplate from './pools.html';
import cloudTemplate from './cloud.html';
import internalTemplate from './internal.html';
import Observer from 'observer';
import style from 'style';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze, mapValues, keyByProperty } from 'utils/core-utils';
import { stringifyAmount} from 'utils/string-utils';
import { formatSize, toBytes } from 'utils/size-utils';
import { action$, state$ } from 'state';
import { openInstallNodesModal, openAddCloudResrouceModal } from 'action-creators';
import { aggregateStorage } from 'utils/storage-utils';
import { countNodesByState } from 'utils/ui-utils';
import * as routes from 'routes';

const resourceTypes = deepFreeze({
    HOSTS: {
        label: 'Pools',
        tooltip: 'This number is calculated from the total capacity of all installed nodes in the system regardless to current usage or availability.'
    },
    CLOUD: {
        label: 'Cloud',
        tooltip: 'This number is an estimated aggregation of all public cloud resources connected to the system. Any cloud resource is define as 1PB of raw storage.'
    },
    INTERNAL: {
        label : 'Internal',
        tooltip: 'Internal storage is a resource which resides on the local VM’s disks. It can only be used for spilled-over data from buckets. This number represents the amount of total internal storage in the system.',
        preview: true
    }
});

class ResourceOverviewViewModel extends Observer {
    constructor({ selectedResourceType, onResourceType  }) {
        super();

        this.selectedResourceType = selectedResourceType;
        this.onResourceType = onResourceType;
        this.tooltips = mapValues(resourceTypes, ({ tooltip }) => tooltip);
        this.resourceTypeOptions = Object.entries(resourceTypes)
            .map(([value, { label, preview = false }]) => ({ value, label, preview }));

        this.poolsTemplate = poolsTemplate;
        this.cloudTemplate = cloudTemplate;
        this.internalTemplate = internalTemplate;

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
        this.resourcesLinkHref = ko.observable();

        this.poolsChartValues = [
            {
                label: 'Online',
                value: ko.observable(),
                color: style['color12']
            },
            {
                label: 'Has issues',
                value: ko.observable(),
                color: style['color11']
            },
            {
                label: 'Offline',
                value: ko.observable(),
                color: style['color10']
            }
        ];

        this.cloudChartValues = [
            {
                label: 'AWS S3',
                value: ko.observable(),
                icon: 'aws-s3-resource',
                color: style['color8']
            },
            {
                label: 'Azure blob',
                value: ko.observable(),
                icon: 'azure-resource',
                color: style['color7']
            },
            {
                label: 'S3 compatible',
                value: ko.observable(),
                icon: 'cloud-resource',
                color: style['color16']
            }
        ];

        this.internalChartValues = [
            {
                label: 'Available',
                value: ko.observable(),
                color: style['color5']
            },
            {
                label: 'Used (Spilled over from buckets)',
                value: ko.observable(),
                color: style['color13']
            }
        ];

        this.observe(
            state$.getMany(
                'nodePools',
                ['cloudResources', 'resources'],
                ['internalResources', 'resources'],
                'buckets',
                'location'
            ),
            this.onState
        );
    }

    onState([nodePools, cloudResources, internalResources, buckets, location]) {
        const poolsList = Object.values(nodePools.pools);
        const nodesByState = countNodesByState(nodePools.nodes);
        const poolsStorageList = poolsList.map(pool => pool.storage);
        const { system } = location.params;

        this.nodeCount(nodesByState.all);
        this.poolsCount(poolsList.length);
        this.poolsChartValues[0].value(nodesByState.healthy);
        this.poolsChartValues[1].value(nodesByState.hasIssues);
        this.poolsChartValues[2].value(nodesByState.offline);
        this.nodesStorage(poolsStorageList.length ? formatSize(aggregateStorage(...poolsStorageList).total) : 0);
        this.nodeCountText(stringifyAmount('Node', this.nodeCount()));

        // cloud resources
        const cloudResourceList = Object.values(cloudResources);
        const cloudStorageList = cloudResourceList.map(cloud => cloud.storage);
        const { AWS = 0, AZURE = 0, S3_COMPATIBLE = 0} =
            keyByProperty(cloudResourceList, 'type', (_, count = 0) => count + 1);

        this.cloudCount(cloudResourceList.length);
        this.cloudChartValues[0].value(AWS);
        this.cloudChartValues[1].value(AZURE);
        this.cloudChartValues[2].value(S3_COMPATIBLE);
        this.cloudStorage(
            formatSize(cloudStorageList.length ? toBytes(aggregateStorage(...cloudStorageList).total) : 0)
        );
        this.cloudCountText(`${this.cloudCount()} Cloud`);
        this.cloudCountSecondaryText(stringifyAmount('resource', this.cloudCount()));

        // internal resources
        const internalResourceList = Object.values(internalResources);
        const internalStorageList = internalResourceList.map(cloud => cloud.storage);
        const { free = 0, used = 0, total = 0 } = aggregateStorage(...internalStorageList);
        const internalCount = internalResourceList.length;

        this.internalChartValues[0].value(free);
        this.internalChartValues[1].value(used);
        this.internalStorage(formatSize(total));
        this.internalResourceState(
            Object.values(buckets).some(bucket => bucket.spilloverEnabled) ? 'Enabled' : 'Disabled'
        );

        this.resourcesLinkHref(realizeUri(routes.pools, { system, tab: 'pools' }, {}));
        this.resourcesLinkText(stringifyAmount(
            'Resource',
            this.poolsCount() + this.cloudCount() + internalCount,
            'No'
        ));
    }

    onInstallNodes() {
        action$.onNext(openInstallNodesModal());
    }

    onAddCloudResource() {
        action$.onNext(openAddCloudResrouceModal());
    }

    typeSelectorToggle() {
        return ko.pureComputed({
            read: this.selectedResourceType,
            write: val => this.onResourceType(val)
        });
    }
}

export default {
    viewModel: ResourceOverviewViewModel,
    template: template
};
