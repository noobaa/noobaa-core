import template from './bucket-objects-table.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { paginationPageSize, inputThrottle } from 'config';
import { deepFreeze, throttle } from 'utils';
import ObjectRowViewModel from './object-row';
import { redirectTo } from 'actions';
import { routeContext, systemInfo } from 'model';

const columns = deepFreeze([
    {
        name: 'name',
        cellTemplate: 'link',
        sortable: true
    },
    {
        name: 'size',
        sortable: true
    }
]);

// TODO: logic should move to server side.
function hasEnoughBackingNodeForUpload(bucket) {
    if (!bucket() || !systemInfo()) {
        return false;
    }

    let tier = systemInfo().tiers.find(
        tier => tier.name === bucket().tiering.tiers[0].tier
    );

    let pools = systemInfo().pools.filter(
        pool => tier.node_pools.includes(pool.name)
    );

    if (tier.data_placement === 'SPREAD') {
        let nodeCount = pools.reduce(
            (count, pool) => count + pool.nodes.online,
            0
        );

        return nodeCount >= 3;

    } else {
        return pools.every(
            pool => pool.nodes.online >= 3
        );
    }
}

class BucketObjectsTableViewModel extends Disposable {
    constructor({ bucket, objectList }) {
        super();

        this.columns = columns;
        this.pageSize = paginationPageSize;

        this.objects = ko.pureComputed(
            () => objectList() && objectList().objects.map(
                pair => pair.info
            )
        );

        this.bucketName = ko.pureComputed(
            () => bucket() && bucket().name
        );

        this.uploadDisabled = ko.pureComputed(
            () => !hasEnoughBackingNodeForUpload(bucket)
        );

        this.uploadTooltip = ko.pureComputed(
            () => this.uploadDisabled() &&
                'Cannot upload, not enough online nodes in bucket storage'
        );

        this.objectCount = ko.pureComputed(
            () => bucket() && bucket().num_objects
        );

        this.filteredObjectCount = ko.pureComputed(
            () => objectList() && objectList().total_count
        );

        let query = ko.pureComputed(
            () => routeContext().query
        );

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: query().sortBy || 'name',
                order: Number(query().order) || 1
            }),
            write: value => this.orderBy(value)
        });

        this.page = ko.pureComputed({
            read: () => Number(query().page) || 0,
            write:  page => this.pageTo(page)
        });

        this.filter = ko.pureComputed({
            read: () => query().filter,
            write: throttle(phrase => this.filterObjects(phrase), inputThrottle)
        });

        this.hasObjects = ko.pureComputed(
            () => this.objects().length > 0
        );

        this.isUploadFilesModalVisible = ko.observable(false);
    }

    createObjectRow(obj) {
        return new ObjectRowViewModel(obj);
    }

    showUploadFilesModal() {
        this.isUploadFilesModalVisible(true);
    }

    hideUploadFilesModal() {
        this.isUploadFilesModalVisible(false);
    }

    pageTo(page) {
        let params = Object.assign(
            {
                filter: this.filter(),
                page: page
            },
            this.sorting()
        );

        redirectTo(undefined, undefined, params);
    }

    filterObjects(phrase) {
        let params = Object.assign(
            {
                filter: phrase || undefined,
                page: 0
            },
            this.sorting()
        );

        redirectTo(undefined, undefined, params);
    }

    orderBy(sorting) {
        let params = Object.assign(
            {
                filter: this.filter(),
                page: 0
            },
            sorting
        );

        redirectTo(undefined, undefined, params);
    }
}

export default {
    viewModel: BucketObjectsTableViewModel,
    template: template
};
