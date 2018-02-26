/* Copyright (C) 2016 NooBaa */

import template from './cloud-resources-table.html';
import Observer from 'observer';
import ko from 'knockout';
import CloudResourceRowViewModel from './cloud-resource-row';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { inputThrottle, paginationPageSize } from 'config';
import { action$, state$ } from 'state';
import { openAddCloudResrouceModal, requestLocation, deleteResource } from 'action-creators';


const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true,
        compareKey: () => true
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
        sortable: true,
        compareKey: resource => resource.name
    },
    {
        name: 'buckets',
        label: 'bucket using resource',
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
        value: '',
        label: 'All Resource Types'
    },
    {
        value: 'AWS',
        label: 'AWS S3',
        icon: 'aws-s3-dark',
        selectedIcon: 'aws-s3-colored'
    },
    {
        value: 'AZURE',
        label: 'Azure Blob',
        icon: 'azure-dark',
        selectedIcon: 'azure-colored'
    },
    {
        value: 'S3_COMPATIBLE',
        label: 'S3 Compatible',
        icon: 'cloud-dark',
        selectedIcon: 'cloud-colored'
    }
];

class CloudResourcesTableViewModel extends Observer {
    columns = columns;
    pageSize = paginationPageSize;
    resourceTypeOptions = resourceTypeOptions;
    selectedResourceType = ko.observable(resourceTypeOptions[0].value);
    resourcesLoaded = ko.observable();
    rows = ko.observableArray();
    filter = ko.observable();
    typeFilter = ko.observable();
    sorting = ko.observable();
    selectedForDelete = ko.observable();
    page = ko.observable();
    resourceCount = ko.observable();
    emptyMessage = ko.observable();
    onFilterThrottled = throttle(this.onFilter, inputThrottle, this);
    deleteGroup = ko.pureComputed({
        read: this.selectedForDelete,
        write: val => this.onSelectForDelete(val)
    });

    constructor() {
        super();

        this.typeSub = this.selectedResourceType.subscribe(value => this.onSelectResourceType(value));

        this.observe(
            state$.getMany(
                'cloudResources',
                'location'
            ),
            this.onState
        );
    }

    onState([cloudResources, location]) {
        if (!cloudResources) {
            this.resourcesLoaded(false);
            return;
        }

        const { params, query, pathname } = location;
        const { tab = 'pools' } = params;
        if (tab !== 'cloud') return;

        const { filter = '', sortBy = 'name', order = 1, page = 0, selectedForDelete, typeFilter = '' } = query;
        const { compareKey } = columns.find(column => column.name === sortBy);
        const cloudResourceList = Object.values(cloudResources);
        const pageStart = Number(page) * this.pageSize;
        const rowParams = {
            deleteGroup: this.deleteGroup,
            onDelete: this.onDeleteCloudResource.bind(this)
        };

        const filteredRows = cloudResourceList
            .filter(
                ({ type, name }) => (!filter || name.toLowerCase().includes(filter)) &&
                    (!typeFilter || type === typeFilter)
            );

        const emptyMessage = filteredRows.length > 0 ?
            'The current filter does not match any cloud resource' :
            'System does not contain any cloud resources';

        const rows = filteredRows
            .sort(createCompareFunc(compareKey, order))
            .slice(pageStart, pageStart + this.pageSize)
            .map((resource, i) => {
                const row = this.rows.get(i) || new CloudResourceRowViewModel(rowParams);
                row.onState(resource);
                return row;
            });

        this.pathname = pathname;
        this.filter(filter);
        this.typeFilter(typeFilter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.resourceCount(filteredRows.length);
        this.selectedForDelete(selectedForDelete);
        this.rows(rows);
        this.emptyMessage(emptyMessage);
        this.resourcesLoaded(true);
    }

    onSelectResourceType(type) {
        this._query({
            typeFilter: type,
            page: 0,
            selectedForDelete: null
        });
    }


    onFilter(filter) {
        this._query({
            filter: filter,
            page: 0,
            selectedForDelete: null
        });
    }

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

    _query(params) {
        const {
            typeFilter = this.typeFilter(),
            filter = this.filter(),
            sorting = this.sorting(),
            page = this.page(),
            selectedForDelete = this.selectedForDelete()
        } = params;

        const { sortBy, order } = sorting;
        const query = {
            typeFilter: typeFilter || undefined,
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: page || undefined,
            selectedForDelete: selectedForDelete || undefined
        };

        action$.onNext(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onSelectForDelete(selected) {
        const selectedForDelete = this.selectedForDelete() === selected ? null : selected;
        this._query({ selectedForDelete });
    }

    onAddCloudResource() {
        action$.onNext(openAddCloudResrouceModal());
    }

    onDeleteCloudResource(name) {
        action$.onNext(deleteResource(name));
    }

    dispose() {
        this.typeSub && this.typeSub.dispose();
    }
}

export default {
    viewModel: CloudResourcesTableViewModel,
    template: template
};
