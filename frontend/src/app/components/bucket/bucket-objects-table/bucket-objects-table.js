import template from './bucket-objects-table.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { paginationPageSize, inputThrottle } from 'config';
import { throttle, makeArray } from 'utils';
import ObjectRowViewModel from './object-row';
import { redirectTo } from 'actions';
import { systemInfo } from 'model';

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
    constructor({ bucket, objects }) {
        super();

        this.bucketName = ko.pureComputed(
            () => bucket() && bucket().name
        );

        this.uploadDisabled = ko.pureComputed(
            () => !hasEnoughBackingNodeForUpload(bucket)
        );

        this.uploadTooltip = ko.pureComputed(
            () => this.uploadDisabled() &&
                'Cannot upload, not enough nodes in bucket storage'
        );

        this.objectCount = ko.pureComputed(
            () => bucket() && bucket().num_objects
        );

        this.pageSize = paginationPageSize;
        this.filteredObjectCount = objects.count;
        this.sortedBy = objects.sortedBy;
        this.order = objects.order;

        this.page = ko.pureComputed({
            read: objects.page,
            write:  page => this.pageTo(page)
        });

        this.filter = ko.pureComputed({
            read: objects.filter,
            write: throttle(phrase => this.filterObjects(phrase), inputThrottle)
        });

        this.hasObjects = ko.pureComputed(
            () => objects().length > 0
        );

        this.rows = makeArray(
            this.pageSize,
            i => new ObjectRowViewModel(
                () => objects()[i]
            )
        );

        this.isUploadFilesModalVisible = ko.observable(false);
    }

    showUploadFilesModal() {
        this.isUploadFilesModalVisible(true);
    }

    hideUploadFilesModal() {
        this.isUploadFilesModalVisible(false);
    }

    pageTo(page) {
        redirectTo(undefined, undefined, {
            filter: this.filter(),
            sortBy: this.sortedBy(),
            order: this.order(),
            page: page
        });
    }

    filterObjects(phrase) {
        redirectTo(undefined, undefined, {
            filter: phrase || undefined,
            sortBy: this.sortedBy(),
            order: this.order(),
            page: 0
        });
    }

    orderBy(colName) {
        redirectTo(undefined, undefined, {
            filter: this.filter(),
            sortBy: colName,
            order: this.sortedBy() === colName ? 0 - this.order() : 1,
            page: 0
        });
    }

    orderClassFor(colName) {
        if (this.sortedBy() === colName) {
            return this.order() === 1 ? 'des' : 'asc';
        }
    }
}

export default {
    viewModel: BucketObjectsTableViewModel,
    template: template
};
