/* Copyright (C) 2016 NooBaa */

import template from './create-bucket-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { getFieldValue, isFieldTouched, isFormValid } from 'utils/form-utils';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { validatePlacementPolicy, warnPlacementPolicy } from 'utils/bucket-utils';
import * as routes from 'routes';
import {
    touchForm,
    updateModal,
    closeModal,
    createBucket
} from 'action-creators';

const steps = deepFreeze([
    {
        label: 'choose name',
        size: 'small'
    },
    {
        label: 'set policy',
        size: 'xlarge'
    }
]);

const fieldsByStep = deepFreeze({
    0: ['bucketName'],
    1: ['policyType', 'selectedResources']
});

function _validatedName(name = '', existing) {
    return [
        {
            valid: 3 <= name.length && name.length <= 63,
            message: '3-63 characters'
        },
        {
            valid: /^[a-z0-9].*[a-z0-9]$/.test(name),
            message: 'Starts and ends with a lowercase letter or number'
        },
        {
            valid: name && /^[a-z0-9.-]*$/.test(name) &&
                !name.includes(' ') &&
                !name.includes('..') &&
                !name.includes('.-') &&
                !name.includes('-.') &&
                !name.includes('--'),
            message: 'Only lowercase letters, numbers, nonconsecutive periods or hyphens'
        },
        {
            valid: name && !/^\d+\.\d+\.\d+\.\d+$/.test(name),
            message: 'Avoid the form of an IP address'
        },
        {
            valid: name && !existing.includes(name),
            message: 'Globally unique name'
        }
    ];
}

class CreateBucketModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    steps = steps.map(step => step.label);
    dataReady = ko.observable();
    resourcesHref = '';
    isStepValid = false;
    nameRestrictionList = ko.observable();
    existingNames = [];
    systemResourceCount = 0;
    hostPools = ko.observable();
    cloudResources = ko.observable();
    fields = {
        step: 0,
        bucketName: '',
        policyType: 'SPREAD',
        selectedResources: []
    };

    onState(state, params) {
        super.onState(state, params);
    }

    selectState(state) {
        return [
            state.buckets,
            state.hostPools,
            state.cloudResources,
            state.forms[this.formName],
            state.location.params.system
        ];
    }

    mapStateToProps(buckets, hostPools, cloudResources, form, system) {
        if (!buckets || !hostPools || !cloudResources || !form) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const existingNames = Object.keys(buckets);
            const systemResourceCount = Object.keys(hostPools).length + Object.keys(cloudResources).length;
            const bucketName = getFieldValue(form, 'bucketName');
            const resourcesHref = realizeUri(routes.resources, { system });
            const isStepValid = isFormValid(form);
            const nameRestrictionList = _validatedName(bucketName, existingNames)
                .map(({ valid, message }) => ({
                    label: message,
                    css: isFieldTouched(form, 'bucketName') ? (valid ? 'success' : 'error') : ''
                }));

            ko.assignToProps(this, {
                existingNames,
                systemResourceCount,
                nameRestrictionList,
                resourcesHref,
                isStepValid,
                hostPools,
                cloudResources,
                regionByResource: {}
            });
        }
    }

    onValidate(values) {
        const { step, bucketName } = values;
        const errors = {};

        if (step === 0) {
            const hasNameErrors = _validatedName(bucketName, this.existingNames)
                .some(({ valid }) => !valid);

            if (hasNameErrors) {
                errors.bucketName = '';
            }

        } else if (step === 1) {
            if (this.systemResourceCount > 0) {
                validatePlacementPolicy(values, errors);
            }
        }

        return errors;
    }

    onWarn(values) {
        const warnings = {};
        if (this.systemResourceCount === 0) {
            warnings.selectedResources = `This Bucket will be using the internal server’s disks capacity as a storage
                resource until a healthy resource will be added`;

        } else {
            warnPlacementPolicy(
                values,
                this.hostPools(),
                this.cloudResources(),
                warnings
            );
        }

        return warnings;
    }

    onBeforeStep(step) {
        if (!this.isStepValid) {
            this.dispatch(touchForm(this.formName, fieldsByStep[step]));
            return false;
        }

        return true;
    }

    onAfterStep(step) {
        const { size } = steps[step];
        this.dispatch(updateModal({ size }));
    }

    onCancel() {
        this.dispatch(closeModal());
    }

    onSubmit(values) {
        const { bucketName, policyType, selectedResources } = values;

        this.dispatch(closeModal());
        this.dispatch(createBucket(bucketName, policyType, selectedResources));
    }
}

export default {
    viewModel: CreateBucketModalViewModel,
    template: template
};
