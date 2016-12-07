import template from './bucket-backup-policy-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import ResourceRow from './resource-row';
import { deepFreeze } from 'utils/all';
import { systemInfo } from 'model';
import { updateBucketBackupPolicy } from 'actions';

const columns = deepFreeze([
    {
        name: 'select',
        label: '',
        type: 'checkbox'
    },
    {
        name: 'type',
        type: 'icon'
    },
    {
        name: 'name',
        label: 'Resource Name'
    },
    {
        name: 'usage',
        label: 'Used by noobaa'
    }
]);

class BucketBackupPolicyModalViewModel extends Disposable {
    constructor({ bucketName, onClose }) {
        super();

        this.columns = columns;
        this.onClose = onClose;

        this.tierName = ko.pureComputed(
            () => {
                if(!systemInfo()) {
                    return '';
                }

                let bucket = systemInfo().buckets.find(
                    bucket => bucket.name === ko.unwrap(bucketName)
                );

                return bucket.tiering.tiers[0].tier;
            }
        );

        this.tier = ko.pureComputed(
            () => {
                if (!systemInfo() || !this.tierName()) {
                    return;
                }

                return systemInfo().tiers.find(
                    ({ name }) =>  this.tierName() === name
                );
            }
        );

        this.resources = ko.pureComputed(
            () => (systemInfo() ? systemInfo().pools : []).filter(
                pool => Boolean(pool.cloud_info)
            )
        );

        this.selectedResources = ko.observableArray(
            Array.from(this.tier().cloud_pools)
        );
    }

    newResourceRow(resoruce) {
        return new ResourceRow(resoruce, this.selectedResources);
    }

    selectAllResources() {
        this.selectedResources(
            this.resources().map(
                resource => resource.name
            )
        );
    }

    clearAllResources() {
        this.selectedResources([]);
    }

    save() {
        updateBucketBackupPolicy(
            this.tierName(),
            this.selectedResources()
        );

        this.onClose();
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: BucketBackupPolicyModalViewModel,
    template: template
};
