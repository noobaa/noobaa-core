/* Copyright (C) 2016 NooBaa */

import template from './edit-account-s3-access-modal.html';
import FormViewModel from 'components/form-view-model';
import state$ from 'state';
import ko from 'knockout';
import { deepFreeze, flatMap } from 'utils/core-utils';
import { sumSize, formatSize } from 'utils/size-utils';
import { updateAccountS3Access } from 'dispatchers';

const storageTypes = deepFreeze({
    AWS: {
        icon: 'aws-s3-resource-dark',
        selectedIcon: 'aws-s3-resource-colored'
    },
    AZURE: {
        icon: 'azure-resource-dark',
        selectedIcon: 'azure-resource-colored'
    },
    S3_COMPATIBLE: {
        icon: 'cloud-resource-dark',
        selectedIcon: 'cloud-resource-colored'
    },
    NODES_POOL: {
        icon: 'nodes-pool'
    }
});

class EditAccountS3AccessModalViewModel extends FormViewModel {
    constructor({ accountEmail, onClose }) {
        super('editAccountS3Access');

        this.onClose = onClose;
        this.email = accountEmail;
        this.buckets = ko.observable();
        this.resources = ko.observable();

        this.observe(state$.get('buckets'), this.onBuckets);
        this.observe(state$.getMany('nodePools', 'cloudResources'), this.onResources);
        this.observe(state$.get('accounts', accountEmail), this.onAccount);
    }

    onBuckets(buckets) {
        this.buckets(Object.keys(buckets));
    }

    onResources(resources) {
        this.resources(
            flatMap(
                resources,
                resourceGroup => Object.values(resourceGroup).map(
                    ({ type = 'NODES_POOL', name: value, storage }) => {
                        const { total, free: available_free, unavailable_free } = storage;
                        const free = sumSize(available_free, unavailable_free);
                        const remark = `${formatSize(free)} of ${formatSize(total)} Available`;
                        return { ...storageTypes[type], value, remark };
                    }
                )
            )
        );
    }

    onAccount(account) {
        if (this.initialized()) {
            return;
        }

        this.initialize({
            enableS3Access: account.hasS3Access,
            selectedBuckets: account.allowedBuckets || [],
            selectedResource: account.defaultResource
        });
    }

    validate({ enableS3Access, selectedResource }) {
        let errors = {};

        // Validate selected resource
        if (enableS3Access && !selectedResource) {
            errors.selectedResource = 'Please select a default resource for the account';
        }

        return { errors };
    }

    selectAllBuckets() {
        this.update('selectedBuckets', this.buckets());
    }

    clearAllBuckets() {
        this.update('selectedBuckets', []);
    }

    save() {
        if (!this.valid()) {
            this.touchAll();
            return;
        }

        updateAccountS3Access(
            this.email,
            this.enableS3Access(),
            this.selectedResource(),
            this.selectedBuckets()
        );

        this.onClose();
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: EditAccountS3AccessModalViewModel,
    template: template
};
