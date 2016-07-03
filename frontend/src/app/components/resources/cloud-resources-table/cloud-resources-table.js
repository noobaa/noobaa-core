import template from './cloud-resources-table.html';
import ko from 'knockout';
import CloudResourceRowViewModel from './cloud-resource-row';
import { systemInfo, routeContext } from 'model';
import { deepFreeze, createCompareFunc } from 'utils';
import { redirectTo } from 'actions';

const columns = deepFreeze([
    {
        name: 'type',
        template: 'icon',
        sortable: true
    },
    {
        name: 'name',
        label: 'resource name',
        sortable: true
    },
    {
        name: 'usage',
        label: 'used capacity by noobaa',
        sortable: true
    },
    {
        name: 'cloudBucket',
        label: 'colud bucket',
        sortable: true
    },
    {
        name: 'delete',
        label: '',
        template: 'delete'
    }
]);

const compareAccessors = Object.freeze({
    type: resource => resource.endpoint,
    name: resource => resource.name,
    usage: resource => resource.storage.used,
    cloudBucket: resource => resource.cloud_info.target_bucket
});

class CloudResourcesTableViewModel {
    constructor() {
        this.columns = columns;

        let deleteGroup = ko.observable();

        let resources = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return;
                }

                return systemInfo().pools.filter(
                    ({ cloud_info }) => cloud_info
                );
            }
        );

        let query = ko.pureComputed(
            () => routeContext().query
        );

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: query().sortBy || 'name',
                order: Number(query().order) || 1
            }),
            write: value => redirectTo(undefined, undefined, value)
        });

        this.rows = ko.pureComputed(
            () => {
                let { sortBy, order } = this.sorting();
                let compareOp = createCompareFunc(compareAccessors[sortBy], order);

                return resources() && resources()
                    .slice(0)
                    .sort(compareOp)
                    .map(
                        resource => new CloudResourceRowViewModel(resource, deleteGroup)
                    );
            }
        );

        this.isAddCloudResourceModalVisible = ko.observable(false);
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
