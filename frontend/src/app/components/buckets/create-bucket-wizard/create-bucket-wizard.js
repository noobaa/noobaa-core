/* Copyright (C) 2016 NooBaa */

import template from './create-bucket-wizard.html';
import chooseNameStepTemplate from './choose-name-step.html';
import setPolicyStepTemplate from './set-policy-step.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import nameValidationRules from 'name-validation-rules';
import { systemInfo } from 'model';
import { createBucket } from 'actions';
import { deepFreeze, keyByProperty } from 'utils/core-utils';

const steps = deepFreeze([
    { label: 'choose name', size: 'medium' },
    { label: 'set policy', size: 'large' }
]);

class CreateBucketWizardViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
        this.steps = steps;
        this.chooseNameStepTemplate = chooseNameStepTemplate;
        this.setPolicyStepTemplate = setPolicyStepTemplate;

        const existingBucketNames = ko.pureComputed(
            () => (systemInfo() ? systemInfo().buckets : []).map(
                ({ name }) => name
            )
        );

        this.bucketName = ko.observable()
            .extend({
                validation: nameValidationRules('bucket', existingBucketNames)
            });

        this.placementType = ko.observable('SPREAD');

        this.pools = ko.pureComputed(
            () => systemInfo() ? systemInfo().pools : []
        );

        this.selectedPools = ko.observableArray()
            .extend({
                required: {
                    message: 'Please select at least one pool for the policy'
                },
                validation: {
                    validator: selected => {
                        return this.placementType() !== 'MIRROR' || selected.length !== 1;
                    },
                    message: 'Mirror policy requires at least 2 participating pools'
                }
            });

        const poolsByName = ko.pureComputed(
            () => keyByProperty(this.pools(), 'name')
        );

        this.isWarningVisible = ko.pureComputed(
            () => {
                if (this.placementType() === 'MIRROR') {
                    return false;
                }

                const selectedPools = this.selectedPools();
                const hasNodesPool = selectedPools.some(
                    name => {
                        const pool = poolsByName()[name];
                        return Boolean(pool && pool.nodes);
                    }
                );
                const hasCloudResource = selectedPools.some(
                    name => {
                        const pool = poolsByName()[name];
                        return Boolean(pool && pool.cloud_info);
                    }
                );

                return hasNodesPool && hasCloudResource;
            }
        );

        this.chooseNameErrors = ko.validation.group([
            this.bucketName
        ]);

        this.setPolicyErrors = ko.validation.group([
            this.selectedPools
        ]);
    }

    validateStep(step) {
        switch (step) {
            case 1:
                if (this.chooseNameErrors().length > 0) {
                    this.chooseNameErrors.showAllMessages();
                    return false;
                }
                break;

            case 2:
                if (this.setPolicyErrors().length > 0) {
                    this.setPolicyErrors.showAllMessages();
                    return false;
                }
                break;
        }

        return true;
    }

    createBucket() {
        createBucket(this.bucketName(), this.placementType(), this.selectedPools());
    }
}

export default {
    viewModel: CreateBucketWizardViewModel,
    template: template
};
