/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-spillover-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ko from 'knockout';
import { state$, action$ } from 'state';
import { flatMap } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import {
    getCloudResourceTypeIcon,
    getInternalResourceDisplayName
} from 'utils/resource-utils';
import { closeModal, updateBucketSpillover } from 'action-creators';

function _getResourceTypeIcon(type, resource) {
    return true &&
        type === 'HOSTS' && 'nodes-pool' ||
        type === 'CLOUD' && getCloudResourceTypeIcon(resource).name ||
        type === 'INTERNAL' && 'internal-storage';
}

function _getResourceOptions(resources, usedResources, type) {
    return Object.values(resources)
        .map(resource => {
            const disabled = usedResources.has(resource.name);
            const tooltip = disabled ? 'Resource is already used for bucket data placement' : '';
            const icon = _getResourceTypeIcon(type, resource);
            const selectedIcon = type === 'CLOUD' ? `${icon}-colored` : undefined;
            const label = type === 'INTERNAL' ? getInternalResourceDisplayName(resource) : resource.name;
            const usage = type === 'CLOUD' ?
                `${formatSize(resource.storage.total)} Available` :
                `${formatSize(resource.storage.free)} of ${formatSize(resource.storage.total)} Available`;

            return {
                type,
                label,
                value: resource.name,
                remark: usage,
                icon,
                selectedIcon,
                disabled,
                tooltip
            };
        });
}

class EditBucketSpilloverModalViewModel extends Observer {
    form = null;
    bucketName = '';
    isFormInitialized = ko.observable();
    resourceOptions = ko.observableArray();
    formName = this.constructor.name;

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);

        this.observe(
            state$.getMany(
                ['buckets', this.bucketName],
                'hostPools',
                'cloudResources',
                'internalResources'
            ),
            this.onState
        );
    }

    onState([bucket, hostPools, cloudResources, internalResources]) {
        if (!bucket || !hostPools || !cloudResources || !internalResources) {
            this.isFormInitialized(false);
            return;
        }

        const { spillover, placement } = bucket;
        const usedResources = new Set(flatMap(
            placement.mirrorSets,
            ms => ms.resources.map(resource =>resource.name)
        ));

        const optionList = [
            ..._getResourceOptions(cloudResources, usedResources, 'CLOUD'),
            ..._getResourceOptions(hostPools, usedResources, 'HOSTS'),
            ..._getResourceOptions(internalResources, usedResources, 'INTERNAL')
        ];

        this.resourceOptions(optionList);
        const internalResourceNames = Object.values(internalResources)
            .map(resource => resource.name);

        if (!this.isFormInitialized()) {
            this.form = new FormViewModel({
                name: this.formName,
                fields: {
                    useSpillover: Boolean(spillover),
                    target: spillover ? spillover.name : ''
                },
                onValidate: this.onValidate.bind(this),
                onWarn: values => this.onWarn(values, internalResourceNames),
                onSubmit: this.onSubmit.bind(this)
            });

            this.isFormInitialized(true);
        }

    }

    onValidate(values) {
        const errors = {};

        const { target, useSpillover } = values;

        if (useSpillover && !target) {
            errors.target = 'Please select a resource from the list';
        }

        return errors;
    }

    onWarn(values, spilloverResources) {
        const warnings = {};

        const { target, useSpillover } = values;

        if (useSpillover && target && spilloverResources.includes(target)) {
            warnings.target = 'Using system internal storage resource is not recommended';
        }

        return warnings;
    }

    onSubmit(values) {
        const { target, useSpillover } = values;
        const resource = useSpillover ? target : null;
        action$.onNext(updateBucketSpillover(this.bucketName, resource));
        action$.onNext(closeModal());
    }

    onCancel() {
        action$.onNext(closeModal());
    }

    dispose() {
        this.form && this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: EditBucketSpilloverModalViewModel,
    template: template
};
