import template from './cloud-resources-table.html';
import Disposable from 'disposable';
import ko from 'knockout';
import CloudResourceRowViewModel from './cloud-resource-row';
import { systemInfo, uiState, routeContext } from 'model';
import { deepFreeze, createCompareFunc } from 'utils';
import { navigateTo } from 'actions';

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

        return systemInfo().buckets.reduce(
            (mapping, bucket) => systemInfo().tiers
                .find(
                    tier => tier.name === bucket.tiering.tiers[0].tier
                )
                .cloud_pools.reduce(
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

const compareAccessors = Object.freeze({
    state: () => true,
    type: resource => resource.cloud_info.endpoint_type,
    name: resource => resource.name,
    buckets: resource => (resourcesToBuckets()[resource.name] || []).length,
    cloudBucket: resource => resource.cloud_info.target_bucket,
    usage: resource => resource.storage.used
});

class CloudResourcesTableViewModel extends Disposable {
    constructor() {
        super();

        this.columns = columns;

        this.sorting = ko.pureComputed({
            read: () => {
                let { query } = routeContext();
                let isOnScreen = uiState().tab === 'cloud';

                return {
                    sortBy: (isOnScreen && query.sortBy) || 'name',
                    order: (isOnScreen && Number(routeContext().query.order)) || 1
                };
            },
            write: value => {
                this.deleteGroup(null);
                navigateTo(undefined, undefined, value);
            }
        });

        this.resources = ko.pureComputed(
            () => {
                let { sortBy, order } = this.sorting();
                let compareOp = createCompareFunc(compareAccessors[sortBy], order);

                return systemInfo() && systemInfo().pools
                    .filter(
                        pool => pool.cloud_info
                    )
                    .slice(0)
                    .sort(compareOp);
            }
        );

        this.deleteGroup = ko.observable();
        this.isAddCloudResourceModalVisible = ko.observable(false);
    }

    newResourceRow(resource) {
        return new CloudResourceRowViewModel(
            resource,
            resourcesToBuckets,
            this.deleteGroup
        );
    }

    showAddCloudResourceModal() {
        this.isAddCloudResourceModalVisible(true);
    }

    hideCloudReousrceModal() {
        this.isAddCloudResourceModalVisible(false);
    }
}

export default {
    viewModel: CloudResourcesTableViewModel,
    template: template
};
