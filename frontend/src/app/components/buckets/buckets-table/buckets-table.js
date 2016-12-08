import template from './buckets-table.html';
import BucketRowViewModel from './bucket-row';
import Disposable from 'disposable';
import ko from 'knockout';
import { deepFreeze, createCompareFunc } from 'utils/all';
import { navigateTo } from 'actions';
import { systemInfo, routeContext } from 'model';

const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon',
        sortable: true
    },
    {
        name: 'name',
        label: 'bucket name',
        type: 'link',
        sortable: true
    },
    {
        name: 'fileCount',
        label: 'files',
        sortable: true
    },
    {
        name: 'placementPolicy',
        sortable: true
    },
    {
        name: 'cloudStorage',
        type: 'cloud-storage'
    },
    {
        name: 'cloudSync',
        sortable: true
    },
    {
        name: 'capacity',
        label: 'used capacity',
        type: 'capacity',
        sortable: true
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

function generatePlacementSortValue(bucket) {
    let tierName = bucket.tiering.tiers[0].tier;
    let { data_placement, attached_pools } = systemInfo() && systemInfo().tiers.find(
        tier => tier.name === tierName
    );
    return [
        data_placement === 'SPREAD' ? 0 : 1,
        attached_pools.length
    ];
}

const compareAccessors = deepFreeze({
    state: bucket => bucket.state,
    name: bucket => bucket.name,
    fileCount: bucket => bucket.num_objects,
    capacity: bucket => bucket.storage.used,
    cloudSync: bucket => bucket.cloud_sync_status,
    placementPolicy: generatePlacementSortValue
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
                navigateTo(undefined, undefined, value);
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
