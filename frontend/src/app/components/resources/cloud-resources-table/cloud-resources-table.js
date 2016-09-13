import template from './cloud-resources-table.html';
import Disposable from 'disposable';
import ko from 'knockout';
import CloudResourceRowViewModel from './cloud-resource-row';
import { systemInfo, routeContext } from 'model';
import { deepFreeze, createCompareFunc } from 'utils';
import { redirectTo } from 'actions';

const columns = deepFreeze([
    {
        name: 'state',
        cellTemplate: 'icon',
        sortable: true
    },
    {
        name: 'type',
        cellTemplate: 'icon',
        sortable: true
    },
    {
        name: 'name',
        label: 'resource name',
        sortable: true
    },
    {
        name: 'buckets',
        label: 'bucket using resource'
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
        cellTemplate: 'delete'
    }
]);

const compareAccessors = Object.freeze({
    state: () => true,
    type: resource => resource.endpoint,
    name: resource => resource.name,
    buckets: () => true,
    usage: resource => resource.storage.used,
    cloudBucket: resource => resource.cloud_info.target_bucket
});

class CloudResourcesTableViewModel extends Disposable {
    constructor() {
        super();

        this.columns = columns;

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: routeContext().query.sortBy || 'name',
                order: Number(routeContext().query.order) || 1
            }),
            write: value => {
                this.deleteGroup(null);
                redirectTo(undefined, undefined, value);
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

        this.poolsToBuckets = ko.pureComputed(
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

        this.deleteGroup = ko.observable();
        this.isAddCloudResourceModalVisible = ko.observable(false);
        this.isAfterDeleteAlertModalVisible = ko.observable(false);
    }

    rowFactory(resource) {
        return new CloudResourceRowViewModel(
            resource,
            this.poolsToBuckets,
            this.deleteGroup,
            () => this.showAfterDeleteAlertModal()
        );
    }

    showAddCloudResourceModal() {
        this.isAddCloudResourceModalVisible(true);
    }

    hideCloudReousrceModal() {
        this.isAddCloudResourceModalVisible(false);
    }

    showAfterDeleteAlertModal() {
        this.isAfterDeleteAlertModalVisible(true);
    }

    hideAfterDeleteAlertModal() {
        this.isAfterDeleteAlertModalVisible(false);
    }
}

export default {
    viewModel: CloudResourcesTableViewModel,
    template: template
};
