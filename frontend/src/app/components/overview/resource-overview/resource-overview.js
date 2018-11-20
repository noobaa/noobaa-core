/* Copyright (C) 2016 NooBaa */

import template from './resource-overview.html';
import ConnectableViewModel from 'components/connectable';
import hostPoolsTemplate from './host-pools.html';
import cloudResourcesTemplate from './cloud-resources.html';
import { stringifyAmount} from 'utils/string-utils';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze, keyByProperty, sumBy, assignWith, groupBy, mapValues } from 'utils/core-utils';
import { summrizeHostModeCounters } from 'utils/host-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import * as routes from 'routes';
import { requestLocation, openAddResourcesModal } from 'action-creators';
import ko from 'knockout';
import style from 'style';
import numeral from 'numeral';

const resourceTypes = deepFreeze([
    {
        label: 'Pools',
        value: 'HOST_POOLS',
        template: hostPoolsTemplate
    },
    {
        label: 'Cloud',
        value: 'CLOUD_RESOURCES',
        template: cloudResourcesTemplate
    }
]);

const hostPoolTooltip = 'Nodes pool is a group of nodes that can be used for NooBaa\'s bucket data placement policy.';
const hostStorageTooltip = 'This number is calculated from the total capacity of all installed nodes in the system regardless to current usage or availability';
const cloudTooltip = 'Cloud resource can be an Azure blob storage, AWS bucket or any S3 compatible service and can be used for NooBaa\'s bucket data placement policy';
const cloudStorageTooltip = 'This number is an estimated aggregation of all public cloud resources connected to the system. Any cloud resource is defined as 1PB of raw storage';

class ResourceOverviewViewModel extends ConnectableViewModel {
    resourceTypes = resourceTypes;
    templates = keyByProperty(resourceTypes, 'value', meta => meta.template);
    pathname = '';
    dataReady = ko.observable();
    resourcesLinkText = ko.observable();
    resourcesLinkHref = ko.observable();
    selectedResourceType = ko.observable();

    // Host pools observables
    hostPoolTooltip = hostPoolTooltip;
    hostStorageTooltip= hostStorageTooltip;
    poolCount = ko.observable();
    hostCount = ko.observable();
    poolsCapacity = ko.observable();
    hostCounters = [
        {
            label: 'Healthy',
            color: style['color12'],
            value: ko.observable(),
            tooltip: 'The number of fully operative storage nodes that can be used as a storage target for NooBaa'
        },
        {
            label: 'Issues',
            color: style['color11'],
            value: ko.observable(),
            tooltip: 'The number of storage nodes that are partially operative due to a current process or low spec'
        },
        {
            label: 'Offline',
            color: style['color10'],
            value: ko.observable(),
            tooltip: 'The number of storage nodes that are currently not operative and are not considered as part of NooBaa’s available storage'
        }
    ];

    // Cloud resources observables
    cloudTooltip = cloudTooltip;
    cloudStorageTooltip = cloudStorageTooltip;
    cloudResourceCount = ko.observable();
    cloudServiceCount = ko.observable();
    cloudCapacity = ko.observable();
    cloudCounters = [
        {
            label: 'AWS S3',
            color: style['color8'],
            value: ko.observable(),
            tooltip: 'AWS S3 cloud resources that were created in this system'
        },
        {
            label: 'Azure blob',
            color: style['color16'],
            value: ko.observable(),
            tooltip: 'Azure blob cloud resources that were created in this system'
        },
        {
            label: 'Google Cloud',
            color: style['color7'],
            value: ko.observable(),
            tooltip: 'Google cloud resources that were created in this system'
        },
        {
            label: 'Pure FlashBlade',
            color: style['color19'],
            value: ko.observable(),
            visible: ko.observable(),
            tooltip: 'Pure FlashBlade resources that were created in this system'
        },
        {
            label: 'S3 compatible',
            color: style['color6'],
            value: ko.observable(),
            tooltip: 'Any S3 compatible cloud resources that were created in this system'
        }
    ];

    selectState(state) {
        return [
            state.location,
            state.hostPools,
            state.cloudResources
        ];
    }

    mapStateToProps(location, hostPools, cloudResources) {
        if (!hostPools || !cloudResources) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { pathname, params } = location;
            const baseQuery = location.query;
            const { selectedResourceType = resourceTypes[0].value } = baseQuery;
            const resourceCount = sumBy(
                [ hostPools, cloudResources ],
                collection => Object.keys(collection).length
            );
            const resourcesLinkText = stringifyAmount('resource', resourceCount);
            const resourcesLinkHref = realizeUri(routes.resources, { system: params.system });

            // Host pools related:
            const poolList = Object.values(hostPools);
            const aggregate = assignWith(
                {},
                ...poolList.map(pool => pool.hostsByMode),
                (sum = 0, count) =>  sum + count
            );
            const hostCounters  = summrizeHostModeCounters(aggregate);
            const poolCount = numeral(poolList.length).format(',');
            const hostCount = numeral(hostCounters.all).format(',');
            const poolsCapacity = formatSize(sumSize(
                ...poolList.map(pool => pool.storage.total)
            ));

            // Cloud resources realted:
            const resourceList = Object.values(cloudResources);
            const serviceCounters = mapValues(
                groupBy(resourceList, resource => resource.type),
                resources => resources.length
            );
            const serviceCount = Object.keys(serviceCounters).length;
            const cloudResourceCount = numeral(resourceList.length).format(',');
            const cloudServiceCount = numeral(serviceCount).format(',');
            const cloudCapacity = formatSize(sumSize(
                ...resourceList.map(resource => resource.storage.total)
            ));

            ko.assignToProps(this, {
                dataReady: true,
                baseQuery,
                pathname,
                selectedResourceType,
                resourcesLinkText,
                resourcesLinkHref,
                poolCount,
                hostCount,
                poolsCapacity,
                hostCounters: [
                    { value: hostCounters.healthy },
                    { value: hostCounters.hasIssues },
                    { value: hostCounters.offline }
                ],
                cloudResourceCount,
                cloudServiceCount,
                cloudCapacity,
                cloudCounters: [
                    { value: serviceCounters.AWS || 0 },
                    { value: serviceCounters.AZURE || 0 },
                    { value: serviceCounters.GOOGLE || 0 },
                    {
                        value: serviceCounters.FLASHBLADE || 0,
                        visible: Boolean(serviceCounters.FLASHBLADE)
                    },
                    { value: serviceCounters.S3_COMPATIBLE || 0 }
                ]
            });
        }
    }

    onSelectResourceType(type) {
        const query = { ...this.baseQuery, selectedResourceType: type };
        const uri = realizeUri(this.pathname, {}, query);
        this.dispatch(requestLocation(uri, true));
    }

    onAddResources() {
        this.dispatch(openAddResourcesModal());
    }
}

export default {
    viewModel: ResourceOverviewViewModel,
    template: template
};
