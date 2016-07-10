import template from './bucket-backup-policy-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import ResourceRow from './resource-row';
import { systemInfo } from 'model';
import { updateBucketBackupPolicy } from 'actions';

class BucketBackupPolicyModalViewModel extends Disposable {
    constructor({ policy, onClose }) {
        super();

        this.onClose = onClose;

        this.tierName = ko.pureComputed(
            () => ko.unwrap(policy) && ko.unwrap(policy).tiers[0].tier
        );

        let tier = ko.pureComputed(
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
            () => (systemInfo() ? systemInfo().pools : [])
                .filter(
                   ({ cloud_info }) => cloud_info
                )
                .map(
                    pool => new ResourceRow(pool, tier())
                )
        );
    }

    selectAllResources() {
        this.resources().forEach(
            ({ selected }) => selected(true)
        );
    }

    clearAllResources() {
        this.resources().forEach(
            ({ selected }) => selected(false)
        );
    }

    save() {
        let selectedResources = this.resources()
            .filter(
                ({ selected }) => selected()
            )
            .map(
                ({ name }) => name
            );

        updateBucketBackupPolicy(
            this.tierName(),
            selectedResources
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
