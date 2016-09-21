import template from './buckets-table.html';
import BucketRowViewModel from './bucket-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze, createCompareFunc } from 'utils';
import { redirectTo } from 'actions';
import { systemInfo, routeContext } from 'model';

const columns = deepFreeze([
    {
        name: 'state',
        cellTemplate: 'icon',
        sortable: true
    },
    {
        name: 'name',
        label: 'bucket name',
        cellTemplate: 'link',
        sortable: true
    },
    {
        name: 'fileCount',
        label: 'files',
        sortable: true
    },
    {
        name: 'placementPolicy'
    },
    {
        name: 'cloudStorage',
        cellTemplate: 'cloud-storage'
    },
    {
        name: 'cloudSync',
        sortable: true
    },
    {
        name: 'capacity',
        label: 'used capacity',
        cellTemplate: 'capacity',
        sortable: true
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        cellTemplate: 'delete'
    }
]);

const compareAccessors = deepFreeze({
    state: bucket => bucket.state,
    name: bucket => bucket.name,
    fileCount: bucket => bucket.num_objects,
    capacity: bucket => bucket.storage.used,
    cloudSync: bucket => bucket.cloud_sync_status
});

class BucketsTableViewModel extends Disposable {
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

        this.buckets = ko.pureComputed(
            () => {
                let { sortBy, order } = this.sorting();
                let compareOp = createCompareFunc(compareAccessors[sortBy], order);

                return systemInfo() && systemInfo().buckets
                    .slice(0)
                    .sort(compareOp);
            }
        );

        this.hasSingleBucket = ko.pureComputed(
            () => this.buckets().length === 1
        );

        this.deleteGroup = ko.observable();
        this.isCreateBucketWizardVisible = ko.observable(false);
    }

    newBucketRow(bucket) {
        return new BucketRowViewModel(
            bucket,
            this.deleteGroup,
            this.hasSingleBucket
        );
    }

    showCreateBucketWizard() {
        this.isCreateBucketWizardVisible(true);
    }

    hideCreateBucketWizard() {
        this.isCreateBucketWizardVisible(false);
    }
}

export default {
    viewModel: BucketsTableViewModel,
    template: template
};
