/* Copyright (C) 2016 NooBaa */

import template from './cloud-resources-table.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, throttle, createCompareFunc, groupBy } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { includesIgnoreCase, stringifyAmount } from 'utils/string-utils';
import { formatSize } from 'utils/size-utils';
import { inputThrottle, paginationPageSize } from 'config';
import { openAddCloudResourceModal, requestLocation, deleteResource } from 'action-creators';
import * as routes from 'routes';
import {
    unassignedRegionText,
    getCloudResourceStateIcon,
    getCloudResourceTypeIcon
} from 'utils/resource-utils';

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
        type: 'link',
        label: 'resource name',
        sortable: true,
        compareKey: resource => resource.name
    },
    {
        name: 'region',
        sortable: true,
        compareKey: resource => resource.region
    },
    {
        name: 'buckets',
        label: 'connected buckets',
        sortable: true,
        compareKey: resource => resource.usedBy.length
    },
    {
        name: 'cloudBucket',
        label: 'cloud target bucket',
        sortable: true,
        compareKey: resource => resource.target
    },
    {
        name: 'usage',
        label: 'used capacity by noobaa',
        sortable: true,
        compareKey: resource => resource.storage.used
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

function _mapResourceToRow(resource, selectedForDelete, system, lockingAccounts) {
    const {
        name,
        region = unassignedRegionText,
        usedBy,
        target,
        undeletable,
        storage
    } = resource;

    const bucketCount = usedBy.length;

    return {
        state: getCloudResourceStateIcon(resource),
        type: getCloudResourceTypeIcon(resource),
        name: {
            text: name,
            href: realizeUri(routes.cloudResource, { system, resource: name })
        },
        region: {
            text: region,
            tooltip: region
        },
        buckets: {
            text: stringifyAmount('bucket', bucketCount),
            tooltip: bucketCount > 0 ? {
                template: 'linkList',
                text: usedBy.map(bucket => ({
                    text: bucket,
                    href: realizeUri(routes.bucket, { system, bucket })
                }))
            } :null
        },
        usage: formatSize(storage.used),
        cloudBucket: target,
        deleteButton: {
            id: name,
            active: selectedForDelete === name,
            disabled: Boolean(undeletable),
            tooltip: {
                text: {
                    subject: 'resource',
                    reason: undeletable,
                    accounts: lockingAccounts
                }
            }
        }
    };
}

class RowViewModel {
    state = ko.observable();
    type = ko.observable();
    name = ko.observable();
    region = ko.observable();
    buckets = ko.observable();
    usage = ko.observable();
    cloudBucket = ko.observable();
    deleteButton = {
        id: ko.observable(),
        text: 'Delete resource',
        active: ko.observable(),
        tooltip: {
            template: 'deleteResource',
            text: ko.observable()
        },
        disabled: ko.observable(),
        onToggle: id => this.onToggle(id),
        onDelete: id => this.onDelete(id)
    };

    constructor({ table }) {
        this.table = table;
    }

    onToggle(id) {
        this.table.onSelectForDelete(id);
    }

    onDelete(id) {
        this.table.onDelete(id);
    }
}

class CloudResourcesTableViewModel extends ConnectableViewModel {
    columns = columns;
    pageSize = paginationPageSize;
    resourceTypeOptions = resourceTypeOptions;
    pathname = '';
    resourcesLoaded = ko.observable();
    rows = ko.observableArray();
    filter = ko.observable();
    typeFilter = ko.observable();
    sorting = ko.observable();
    selectedForDelete = '';
    page = ko.observable();
    resourceCount = ko.observable();
    emptyMessage = ko.observable();
    rows = ko.observableArray()
        .ofType(RowViewModel, { table: this });

    selectState(state) {
        return [
            state.cloudResources,
            state.accounts,
            state.location
        ];
    }

    mapStateToProps(cloudResources, accounts, location) {
        const { tab = 'cloud' } = location.params;
        if (tab !== 'cloud' || !cloudResources || !accounts) {
            ko.assignToProps(this, {
                resourcesLoaded: false
            });

        } else {
            const { params, query, pathname } = location;
            const { filter = '', sortBy = 'name', selectedForDelete, typeFilter = 'ALL' } = query;
            const order = Number(query.order || 1);
            const page = Number(query.page || 0);
            const { compareKey } = columns.find(column => column.name === sortBy);
            const cloudResourceList = Object.values(cloudResources);
            const pageStart = page * this.pageSize;
            const nameFilter = filter.trim().toLowerCase();

            const accountsByUsingResource = groupBy(
                Object.values(accounts),
                account => account.defaultResource,
                account => {
                    const name = account.name;
                    const href = realizeUri(routes.account, {
                        system: params.system,
                        account: name
                    });
                    return { name, href };
                }
            );

            const filteredRows = cloudResourceList
                .filter(resource => _matchFilters(resource, typeFilter, nameFilter));

            const rows = filteredRows
                .sort(createCompareFunc(compareKey, order))
                .slice(pageStart, pageStart + this.pageSize)
                .map(resource => _mapResourceToRow(
                    resource,
                    selectedForDelete,
                    params.system,
                    accountsByUsingResource[resource.name]
                ));

            const emptyMessage =
                (filteredRows.length > 0 && 'The current filter does not match any cloud resource') ||
                (typeFilter === 'ALL' && 'System does not contain any cloud resources') ||
                `System does not contain any ${resourceTypeOptions.find(t => t.value == typeFilter).label} resources`;

            ko.assignToProps(this, {
                resourcesLoaded: true,
                pathname,
                filter,
                typeFilter,
                page,
                sorting: { sortBy, order },
                resourceCount: filteredRows.length,
                selectedForDelete: selectedForDelete,
                rows,
                emptyMessage
            });
        }
    }

    onTypeFilter(type) {
        this._query({
            typeFilter: type,
            page: 0,
            selectedForDelete: null
        });
    }


    onFilter = throttle(filter => {
        this._query({
            filter: filter,
            page: 0,
            selectedForDelete: null
        });
    }, inputThrottle)

    onSort(sorting) {
        this._query({
            sorting,
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

    onSelectForDelete(selected) {
        this._query({ selectedForDelete: selected });
    }

    onAddCloudResource() {
        this.dispatch(openAddCloudResourceModal());
    }

    onDeleteCloudResource(name) {
        this.dispatch(deleteResource(name));
    }

    _query(params) {
        const {
            typeFilter = this.typeFilter(),
            filter = this.filter(),
            sorting = this.sorting(),
            page = this.page(),
            selectedForDelete = this.selectedForDelete
        } = params;

        const { sortBy, order } = sorting;
        const query = {
            typeFilter: typeFilter,
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: page || undefined,
            selectedForDelete: selectedForDelete || undefined
        };

        this.dispatch(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }
}

export default {
    viewModel: CloudResourcesTableViewModel,
    template: template
};
