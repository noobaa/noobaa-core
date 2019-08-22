/* Copyright (C) 2016 NooBaa */

import template from './storage-resources-table.html';
import ConnectableViewModel from 'components/connectable';
import { realizeUri } from 'utils/browser-utils';
import { deepFreeze, throttle, createCompareFunc, groupBy, flatMap } from 'utils/core-utils';
import { stringifyAmount, includesIgnoreCase } from 'utils/string-utils';
import { flatPlacementPolicy } from 'utils/bucket-utils';
import { summrizeHostModeCounters } from 'utils/host-utils';
import { toBytes } from 'utils/size-utils';
import ko from 'knockout';
import * as routes from 'routes';
import { inputThrottle, paginationPageSize } from 'config';
import numeral from 'numeral';
import {
    unassignedRegionText,
    getHostPoolStateIcon,
    getCloudResourceStateIcon,
    getCloudResourceTypeIcon,
    getResourceTypeDisplayName
} from 'utils/resource-utils';
import {
    requestLocation,
    openDeployK8sPoolModal,
    openAddCloudResourceModal,
    deleteResource,
    openDeletePoolWithDataWarningModal
} from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: resource => resource.mode
    },
    {
        name: 'type',
        type: 'icon',
        sortable: true,
        compareKey: resource => resource.type
    },
    {
        name: 'name',
        label: 'resource name',
        type: 'link',
        sortable: true,
        compareKey: resource => resource.name
    },
    {
        name: 'region',
        sortable: true,
        compareKey: resource => resource.region || ''
    },
    {
        name: 'buckets',
        label: 'connected buckets',
        sortable: true,
        compareKey: (resource, bucketsByResource) =>
            (bucketsByResource[resource.name] || []).length
    },
    {
        name: 'hosts',
        label: 'Nubmer of Nodes',
        sortable: true,
        compareKey: resource => resource.type === 'HOSTS' ?
            resource.configuredHostCount :
            -1
    },
    {
        name: 'capacity',
        label: 'used capacity',
        type: 'capacity',
        sortable: true,
        compareKey: resource =>
            toBytes(resource.storage.used) +
            toBytes(resource.storage.usedOther)
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

const resourceTypeOptions = [
    {
        value: 'ALL',
        label: 'All Resource Types'
    },
    {
        value: 'HOSTS',
        label: 'Kubernetes Pool',
        icon: 'nodes-pool'
    },
    {
        value: 'AWS',
        label: 'AWS S3',
        icon: 'aws-s3'
    },
    {
        value: 'AZURE',
        label: 'Azure Blob',
        icon: 'azure'
    },
    {
        value: 'GOOGLE',
        label: 'Google Cloud',
        icon: 'google-cloud'
    },
    {
        value: 'S3_COMPATIBLE',
        label: 'S3 Compatible',
        icon: 'cloud'
    },
    {
        value: 'FLASHBLADE',
        label: 'Pure FlashBlade',
        icon: 'pure'
    }
];

function _getBucketsByResource(buckets) {
    const placement = flatMap(
        Object.values(buckets),
        bucket => flatPlacementPolicy(bucket)
    );

    return groupBy(
        placement,
        r => r.resource.name,
        r => r.bucket
    );
}

function _matchFilters(resource, typeFilter, textFilter) {
    const { type, name, region = '' } = resource;

    // Filter by resource type:
    if (typeFilter !== 'ALL' && type !== typeFilter) {
        return false;
    }

    return (
        includesIgnoreCase(name, textFilter) ||
        includesIgnoreCase(region, textFilter)
    );
}

function _getHostsColumnValue(resource) {
    if (resource.type === 'HOSTS') {
        const { all, healthy, hasIssues, offline } = summrizeHostModeCounters(resource.hostsByMode);
        return {
            text: numeral(all).format(','),
            tooltip: {
                template: 'propertySheet',
                text: [
                    {
                        label: 'Healthy Nodes',
                        value: numeral(healthy).format(',')
                    },
                    {
                        label: 'Nodes with issues',
                        value: numeral(hasIssues).format(',')
                    },
                    {
                        label: 'Offline nodes',
                        value: numeral(offline).format(',')
                    }
                ]
            }
        };
    } else {
        return {
            text: '---'
        };
    }
}

function _getEmptyMessage(resourceCount, typeFilter, filteredCount) {
    if (resourceCount === 0) {
        return 'There are no existing storage resources in the system';
    }

    if (filteredCount === 0) {
        const subject = typeFilter !== 'ALL' ?
            resourceTypeOptions.find(t => t.value == typeFilter).label.toLowerCase() :
            'storage';

        return `The current filter does not match any ${subject} resource`;
    }
}

function _mapResourceToRow(
    resource,
    connectedBuckets,
    selectedForDelete,
    system,
    lockingAccounts,
) {
    const {
        type,
        name,
        region = unassignedRegionText,
        storage,
        undeletable = ''
    } = resource;

    const stateIcon = type === 'HOSTS' ?
        getHostPoolStateIcon(resource) :
        getCloudResourceStateIcon(resource);

    const typeIcon = type === 'HOSTS' ?
        ({ name: 'nodes-pool', tooltip: 'Kubernetes Pool' }) :
        getCloudResourceTypeIcon(resource);

    const resourceUri = type === 'HOSTS' ?
        realizeUri(routes.pool, { system, pool: name }) :
        realizeUri(routes.cloudResource, { system, resource: name });

    const subject = getResourceTypeDisplayName(
        resource.type === 'HOSTS' ? 'HOSTS' : 'CLOUD'
    );

    return {
        state: {
            ...stateIcon,
            tooltip: {
                text: stateIcon.tooltip,
                align: 'start'
            }
        },
        type: typeIcon,
        name: {
            text: name,
            href: resourceUri
        },
        region: {
            text: region,
            tooltip: region
        },
        buckets: {
            text: connectedBuckets.length ? stringifyAmount('bucket',  connectedBuckets.length) : 'None',
            tooltip: connectedBuckets.length ? {
                template: 'linkList',
                text: connectedBuckets.map(name => ({
                    text: name,
                    href: realizeUri(routes.bucket, { system, bucket: name })
                }))
            } : ''
        },
        hosts: _getHostsColumnValue(resource),
        inUse: Boolean(storage.used),
        capacity: {
            total: storage.total,
            used: [
                { value: storage.used },
                { value: storage.usedOther }
            ]
        },
        deleteButton: {
            id: name,
            text: `Delete ${subject}`,
            disabled: Boolean(undeletable),
            active: selectedForDelete === name,
            tooltip: {
                text: {
                    subject: subject,
                    reason: undeletable,
                    accounts: lockingAccounts
                }
            }
        }
    };
}

class RowViewModel {
    table = null;
    state = ko.observable();
    type = ko.observable();
    name = ko.observable();
    region = ko.observable();
    buckets = ko.observable();
    hosts = ko.observable();
    inUse = false;
    capacity = {
        total: ko.observable(),
        used: [
            {
                label: 'Used (Noobaa)',
                value: ko.observable()
            },
            {
                label: 'Used (other)',
                value: ko.observable()
            }
        ]
    };
    deleteButton = {
        text: ko.observable(),
        id: ko.observable(),
        active: ko.observable(),
        disabled: ko.observable(),
        tooltip: {
            template: 'deleteResource',
            text: ko.observable()
        },
        onToggle: this.onToggle.bind(this),
        onDelete: this.onDelete.bind(this)
    };

    constructor({ table }) {
        this.table = table;
    }

    onToggle(poolName) {
        this.table.onSelectForDelete(poolName, this.inUse);
    }

    onDelete(poolName) {
        this.table.onDeletePool(poolName);
    }
}

class StorageResourcesTableViewModel extends ConnectableViewModel {
    columns = columns;
    pageSize = paginationPageSize;
    resourceTypeOptions = resourceTypeOptions;
    pathname = '';
    dataReady = ko.observable();
    isCreatePoolDisabled = ko.observable();
    createPoolTooltip = ko.observable();
    filter = ko.observable();
    typeFilter = ko.observable();
    sorting = ko.observable();
    page = ko.observable();
    resourceCount = ko.observable();
    emptyMessage = ko.observable();
    rows = ko.observableArray()
        .ofType(RowViewModel, { table: this })

    selectState(state) {
        return [
            state.hostPools,
            state.cloudResources,
            state.accounts,
            state.buckets,
            state.location
        ];
    }

    mapStateToProps(pools, cloudResources, accounts, buckets, location) {
        const { system, tab } = location.params;
        if (tab && tab !== 'storage') return;

        if (!pools || !cloudResources || !accounts || !buckets) {
            ko.assignToProps(this, {
                dataReady: false,
                isCreatePoolDisabled: true
            });

        } else {
            const { filter = '', typeFilter = 'ALL', sortBy = 'name', selectedForDelete } = location.query;
            const order = Number(location.query.order || 1);
            const page = Number(location.query.page || 0);
            const pageStart = page * paginationPageSize;
            const nameFilter = filter.trim().toLowerCase();
            const resourceList = [
                ...Object.values(pools).map(pool => ({ type: 'HOSTS', ...pool })),
                ...Object.values(cloudResources)
            ];
            const filteredResources = resourceList.filter(resource =>
                _matchFilters(resource, typeFilter, nameFilter)
            );
            const bucketsByResource = _getBucketsByResource(buckets);
            const accountsByUsingResource = groupBy(
                Object.values(accounts),
                account => account.defaultResource,
                account => {
                    const name = account.name;
                    const href = realizeUri(routes.account, { system, account: name });
                    return { name, href };
                }
            );
            const compareOp = createCompareFunc(
                columns.find(column => column.name === sortBy).compareKey,
                order,
                bucketsByResource
            );




            ko.assignToProps(this, {
                dataReady: true,
                pathname: location.pathname,
                filter,
                typeFilter,
                sorting: { sortBy, order },
                page,
                resourceCount: filteredResources.length,
                emptyMessage: _getEmptyMessage(resourceList.length, typeFilter, filteredResources.length),
                rows: filteredResources
                    .sort(compareOp)
                    .slice(pageStart, pageStart + paginationPageSize)
                    .map(resource => _mapResourceToRow(
                        resource,
                        bucketsByResource[resource.name] || [],
                        selectedForDelete,
                        system,
                        accountsByUsingResource[resource.name]
                    ))
            });
        }
    }

    onDeplyK8sPool() {
        this.dispatch(openDeployK8sPoolModal());
    }

    onAddCloudResource() {
        this.dispatch(openAddCloudResourceModal());
    }

    onFilter = throttle(filter => {
        this._query({
            filter,
            page: 0,
            selectedForDelete: null
        });
    }, inputThrottle)

    onTypeFilter(type) {
        this._query({
            typeFilter: type,
            page: 0,
            selectedForDelete: null
        });
    }

    onSort(sorting) {
        this._query({
            sortBy: sorting.sortBy,
            order: sorting.order,
            page: 0,
            selectedForDelete: null
        });
    }

    onPage(page) {
        this._query({
            page,
            selectedForDelete: null
        });
    }

    onSelectForDelete(poolName, inUse) {
        if (inUse) {
            this.dispatch(openDeletePoolWithDataWarningModal(poolName));

        } else {
            const selectedForDelete = poolName || '';
            this._query({ selectedForDelete });
        }
    }

    onDeletePool(poolName) {
        this.dispatch(deleteResource(poolName));
    }

    _query(query) {
        const {
            filter = this.filter(),
            typeFilter = this.typeFilter(),
            sortBy = this.sorting().sortBy,
            order = this.sorting().order,
            page = this.page(),
            selectedForDelete = this.selectedForDelete()
        } = query;

        const queryUrl = realizeUri(this.pathname, null, {
            filter: filter || undefined,
            typeFilter: typeFilter,
            sortBy: sortBy,
            order: order,
            page: page,
            selectedForDelete: selectedForDelete || undefined
        });

        this.dispatch(requestLocation(queryUrl));
    }
}

export default {
    viewModel: StorageResourcesTableViewModel,
    template: template
};
