/* Copyright (C) 2016 NooBaa */

import template from './deploy-k8s-pool-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { isFormValid, getFormValues, isFieldTouched } from 'utils/form-utils';
import { validateName } from 'utils/validation-utils';
import { deepFreeze, throttle } from 'utils/core-utils';
import { fromSizeAndUnit, unitsInBytes, formatSize } from 'utils/size-utils';
import { realizeUri } from 'utils/browser-utils';
import { inputThrottle } from 'config';
import numeral from 'numeral';
import * as routes from 'routes';
import {
    updateForm,
    touchForm,
    createHostsPool,
    closeModal
} from 'action-creators';

const valueFieldsByStep = deepFreeze({
    0: [
        'poolName'
    ],
    1: [
        'nodeCount',
        'pvSize',
        'pvSizeUnit'
    ],
    2: [
        'deployMethod'
    ]
});

const unitOptions = deepFreeze([
    'GB',
    'TB',
    'PB'
]);

class DeployK8SPoolModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    steps = [
        'Create Pool',
        'Configure',
        'Review'
    ];
    isStepValid = false;
    existingNames = [];
    nameRestrictionList = ko.observableArray();
    unitOptions = unitOptions;
    formattedNodeCount = ko.observable();
    formattedCapacity = ko.observable()
    deployBtnLabel = ko.observable();
    poolTableHref = ko.observable();
    fields = {
        step: 0,
        poolName: '',
        nodeCount: 3,
        pvSize: 100,
        pvSizeUnit: 'GB',
        deployMethod: 'NOOBAA'
    };

    selectState(state) {
        return [
            state.hostPools,
            state.cloudResources,
            state.system && state.system.name,
            state.forms[this.formName]
        ];
    }

    mapStateToProps(hostPools, cloudResources, systemName, form) {
        if (!hostPools || !cloudResources || !form) {
            return;
        }

        const { poolName, nodeCount, pvSize, pvSizeUnit, deployMethod } = getFormValues(form);
        const isPoolNameTouched = isFieldTouched(form, 'poolName');
        const existingNames = [
            ...Object.keys(hostPools),
            ...Object.keys(cloudResources)
        ];
        const nameRestrictionList = validateName(poolName, existingNames, true)
            .map(record => ({
                label: record.message,
                css: isPoolNameTouched ? (record.valid ? 'success' : 'error') : ''
            }));
        const formattedNodeCount = numeral(nodeCount).format(',');
        const formattedCapacity = formatSize(
            nodeCount * pvSize * unitsInBytes[pvSizeUnit]
        );
        const deployBtnLabel =
                (deployMethod === 'NOOBAA' && 'Deploy') ||
                (deployMethod === 'YAML' && 'Download YAML') ||
                '';

        const poolTableHref = realizeUri(routes.resources, {
            system: systemName,
            tab: 'storage'
        });

        ko.assignToProps(this, {
            existingNames,
            nameRestrictionList,
            isStepValid: isFormValid(form),
            formattedNodeCount,
            formattedCapacity,
            deployBtnLabel,
            poolTableHref
        });
    }

    onPoolName = throttle(
        poolName => this.dispatch(updateForm(this.formName, { poolName })),
        inputThrottle,
        this
    );

    onValidate(values) {
        const { step, poolName, nodeCount, pvSize } = values;
        const errors = {};

        if (step === 0) {
            const hasNameErrors = validateName(poolName, this.existingNames)
                .some(({ valid }) => !valid);

            if (hasNameErrors) {
                errors.poolName = '';
            }

        } else if (step === 1) {
            if (nodeCount < 1 || !Number.isInteger(nodeCount)) {
                errors.nodeCount = 'Please enter a whole number greater then 0';
            }

            if (pvSize < 1 || !Number.isInteger(pvSize)) {
                errors.pvSize = 'Please enter a whole number greater then 0';
            }
        }

        return errors;
    }

    onBeforeStep(step) {
        if (!this.isStepValid) {
            this.dispatch(touchForm(this.formName, valueFieldsByStep[step]));
            return false;
        }

        return true;
    }

    onSubmit(values) {
        const {
            poolName,
            nodeCount,
            pvSize,
            pvSizeUnit,
            deployMethod
        } = values;

        this.dispatch(
            closeModal(),
            createHostsPool(
                poolName,
                nodeCount,
                fromSizeAndUnit(pvSize, pvSizeUnit),
                deployMethod === 'NOOBAA'
            )
        );
    }

    onCancel() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: DeployK8SPoolModalViewModel,
    template: template
};
