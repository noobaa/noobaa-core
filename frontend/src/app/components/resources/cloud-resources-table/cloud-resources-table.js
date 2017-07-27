/* Copyright (C) 2016 NooBaa */

import template from './cloud-resources-table.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import CloudResourceRowViewModel from './cloud-resource-row';
import { systemInfo, routeContext } from 'model';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import { navigateTo } from 'actions';
import { keyByProperty } from 'utils/core-utils';
import { inputThrottle } from 'config';
import { action$ } from 'state';
import { openAddCloudResrouceModal } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true
    },
    {
        name: 'type',
        type: 'icon',
        sortable: true
    },
    {
        name: 'name',
        label: 'resource name',
        sortable: true
    },
    {
        name: 'buckets',
        label: 'bucket using resource',
        sortable: true
    },
    {
        name: 'cloudBucket',
        label: 'cloud target bucket',
        sortable: true
    },
    {
        name: 'usage',
        label: 'used capacity by noobaa',
        sortable: true
    },
    {
        name: 'deleteBtn',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

const resourcesToBuckets = ko.pureComputed(
    () => {
        if (!systemInfo()) {
            return {};
        }

        const poolsByName = keyByProperty(systemInfo().pools, 'name');
        return systemInfo().buckets.reduce(
            (mapping, bucket) => systemInfo().tiers
                .find(tier => tier.name === bucket.tiering.tiers[0].tier)
                .attached_pools
                    .filter(poolName => poolsByName[poolName].resource_type === 'CLOUD')
                    .reduce(
                        (mapping, pool) => {
                            mapping[pool] = mapping[pool] || [];
                            mapping[pool].push(bucket.name);
                            return mapping;
                        },
                        mapping
                    ),
            {}
        );
    }
);

const compareAccessors = deepFreeze({
    state: () => true,
    type: resource => resource.cloud_info.endpoint_type,
    name: resource => resource.name,
    buckets: resource => (resourcesToBuckets()[resource.name] || []).length,
    cloudBucket: resource => resource.cloud_info.target_bucket,
    usage: resource => resource.storage.used
});

const resourceTypeOptions = [
    {
        value: '',
        label: 'All Resource Types'
    },
    {
        value: 'AWS',
        label: 'AWS S3',
        icon: 'aws-s3-resource-dark',
        selectedIcon: 'aws-s3-resource-colored'
    },
    {
        value: 'AZURE',
        label: 'Azure Blob',
        icon: 'azure-resource-dark',
        selectedIcon: 'azure-resource-colored'
    },
    {
        value: 'S3_COMPATIBLE',
        label: 'S3 Compatible',
        icon: 'cloud-resource-dark',
        selectedIcon: 'cloud-resource-colored'
    }
];

class CloudResourcesTableViewModel extends BaseViewModel {
    constructor() {
        super();

        this.columns = columns;

        const query = ko.pureComputed(
            () => routeContext().query || {}
        );

        this.filter = ko.pureComputed({
            read: () => query().filter,
            write: throttle(phrase => this.filterResources(phrase), inputThrottle)
        });

        this.resourceTypeOptions = resourceTypeOptions;
        this.selectedResourceType = ko.pureComputed({
            read: () => query().resourceType || resourceTypeOptions[0].value,
            write: value => this.selectResourceType(value)
        });

        this.sorting = ko.pureComputed({
            read: () => {
                const { sortBy, order } = query();
                const canSort = Object.keys(compareAccessors).includes(sortBy);
                return {
                    sortBy: (canSort && sortBy) || 'name',
                    order: (canSort && Number(order)) || 1
                };
            },
            write: value => this.orderBy(value)
        });

        const allResources = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : []).filter(
                ({ cloud_info }) => Boolean(cloud_info)
            )
        );

        this.resources = ko.pureComputed(
            () => {
                const { sortBy, order } = this.sorting();
                const compareOp = createCompareFunc(compareAccessors[sortBy], order);
                const filter = (this.filter() || '').toLowerCase();
                const resourceType = this.selectedResourceType();

                return allResources()
                    .filter(
                        ({ cloud_info, name }) => name.toLowerCase().includes(filter) &&
                            (!resourceType || cloud_info.endpoint_type === resourceType)
                    )
                    .sort(compareOp);
            }
        );

        this.emptyMessage = ko.pureComputed(
            () => allResources().length > 0 ?
                'The current filter does not match any cloud resource' :
                'System does not contain any cloud resources'
        );

        this.deleteGroup = ko.observable();
    }

    newResourceRow(resource) {
        return new CloudResourceRowViewModel(
            resource,
            resourcesToBuckets,
            this.deleteGroup
        );
    }

    selectResourceType(type) {
        this.deleteGroup(null);

        const resourceType = type || undefined;
        const filter = this.filter() || undefined;
        const { sortBy, order } = this.sorting() || {};
        navigateTo(undefined, undefined, { filter, resourceType, sortBy, order });
    }


    orderBy({ sortBy, order }) {
        this.deleteGroup(null);

        const filter = this.filter() || undefined;
        const resourceType = this.selectedResourceType() || undefined;
        navigateTo(undefined, undefined, { filter, sortBy, order, resourceType });
    }

    filterResources(phrase) {
        this.deleteGroup(null);

        const filter = phrase || undefined;
        const { sortBy, order } = this.sorting() || {};
        const resourceType = this.selectedResourceType() || undefined;
        navigateTo(undefined, undefined, { filter, sortBy, order, resourceType });
    }

    onAddCloudResource() {
        action$.onNext(openAddCloudResrouceModal());
    }
}

export default {
    viewModel: CloudResourcesTableViewModel,
    template: template
};
