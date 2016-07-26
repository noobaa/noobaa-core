import template from './bucket-backup-policy-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import ResourceRow from './resource-row';
import { deepFreeze } from 'utils';
import { systemInfo } from 'model';
import { updateBucketBackupPolicy } from 'actions';

const columns = deepFreeze([
    {
        name: 'select',
        label: '',
        cellTemplate: 'checkbox'
    },
    {
        name: 'type',
        cellTemplate: 'icon'
    },
    {
        name: 'name',
        label: 'Resource Name'
    }
]);

class BucketBackupPolicyModalViewModel extends Disposable {
    constructor({ policy, onClose }) {
        super();

        this.columns = columns;
        this.onClose = onClose;

        this.tierName = ko.pureComputed(
            () => ko.unwrap(policy) && ko.unwrap(policy).tiers[0].tier
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
