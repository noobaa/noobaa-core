/* Copyright (C) 2016 NooBaa */

import template from './edit-bucket-spillover-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import ko from 'knockout';
import { state$, action$ } from 'state';
import { deepFreeze, flatMap } from 'utils/core-utils';
import { formatSize } from 'utils/size-utils';
import { closeModal, updateBucketSpillover } from 'action-creators';

const typeToIcon = deepFreeze({
    HOSTS: 'nodes-pool',
    CLOUD: 'cloud-hollow',
    INTERNAL: 'internal-storage'
});

function _getResourceOptions(resources, placementResources, type) {
    return Object.values(resources)
        .filter(resource => !placementResources
            .some(({ name, type }) => name === resource.name && type === type)
        )
        .map(resource => {
            const icon = typeToIcon[type];
            const usage = type === 'CLOUD' ?
                `${formatSize(resource.storage.total)} Available` :
                `${formatSize(resource.storage.free)} of ${formatSize(resource.storage.total)} Available`;

            return {
                type,
                label: type === 'INTERNAL' ? 'internal-storage' : resource.name,
                value: resource.name,
                remark: usage,
                icon: icon,
                selectedIcon: icon
            };
        });
}

class EditBucketSpilloverModalViewModel extends Observer {
    form = null;
    bucketName = '';
    spillover = ko.observable();
    isFormInitialized = ko.observable();
    isSpilloverResourceWarning = ko.observable();
    resourceOptions = ko.observableArray();
    formName = '';

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);
        this.formName = this.constructor.name;

        this.observe(
            state$.getMany(
                ['buckets', this.bucketName],
                'hostPools',
                'cloudResources',
                'internalResources',
                ['forms', this.formName]
            ),
            this.onState
        );
    }

    onState([bucket, hostPools, cloudResources, internalResources, form]) {
        if (!bucket || !hostPools || !cloudResources || !internalResources) {
            this.isFormInitialized(false);
            this.isSpilloverResourceWarning(false);
            return;
        }

        const { spillover, placement } = bucket;
        const placementResources = flatMap(placement.mirrorSets, ms => ms.resources);
        const isSpilloverResourceWarning = form && form.fields.target.touched && form.warnings.target;
        const poolList = _getResourceOptions(hostPools, placementResources, 'HOSTS');
        const cloudList = _getResourceOptions(cloudResources, placementResources, 'CLOUD');
        const internalList =  _getResourceOptions(internalResources, placementResources, 'INTERNAL');

        const resourceList = [
            ...poolList,
            ...cloudList,
            ...internalList
        ];


        this.spillover(spillover);
        this.resourceOptions(resourceList);
        this.isSpilloverResourceWarning(isSpilloverResourceWarning);

        if (!form) {
            this.form = new FormViewModel({
                name: this.formName,
                fields: {
                    isSpillover: Boolean(spillover),
                    target: spillover && spillover.name
                },
                onValidate: this.onValidate.bind(this),
                onWarn: this.onWarn.bind(this),
                onSubmit: this.onSubmit.bind(this)
            });

            this.isFormInitialized(true);
        }

    }

    onValidate(values) {
        const errors = {};

        const { target, isSpillover } = values;

        if (isSpillover && !target) {
            errors.target = '`Please select a resource from the list';
        }

        return errors;
    }

    onWarn(values) {
        const warnings = {};

        const { target, isSpillover } = values;

        if (isSpillover && target) {
            const isInternalResourceSelected = this.resourceOptions()
                .find(resource => resource.value === target).type === 'INTERNAL';

            if (isInternalResourceSelected) {
                warnings.target = 'Using system internal storage resource is not recommended';
            }
        }

        return warnings;
    }

    onSubmit(values) {
        const { target, isSpillover } = values;
        const resource = isSpillover ? target : null;
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
