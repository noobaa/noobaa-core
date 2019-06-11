/* Copyright (C) 2016 NooBaa */

import template from './install-nodes-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { getFormValues, isFormValid } from 'utils/form-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import { installNodes as learnMoreHref } from 'knowledge-base-articles';
import {
    touchForm,
    openCreateEmptyPoolModal,
    fetchNodeInstallationCommands,
    closeModal
} from 'action-creators';

const steps = deepFreeze([
    'Assign',
    'Select Drives',
    'Install'
]);

const drivesInputPlaceholder =
    `e.g., /mnt or c:\\ and click enter ${String.fromCodePoint(0x23ce)}`;

const _compareByCreationTime = createCompareFunc(pool => pool.creationTime, -1);

class InstallNodeModalViewModel extends ConnectableViewModel {
    learnMoreHref = learnMoreHref;
    formName = this.constructor.name;
    steps = steps;
    drivesInputPlaceholder = drivesInputPlaceholder;
    poolActions = [{
        label: 'Create new pool',
        onClick: this.onCreateNewPool.bind(this)
    }];
    poolOptions = ko.observableArray();
    hostPoolsHref = ko.observable();
    targetPool = '';
    excludeDrives = [];
    isStepValid = false;
    fields = {
        step: 0,
        targetPool: '',
        excludeDrives: false,
        excludedDrives: [],
        command: ''
    };

    selectState(state) {
        const { hostPools, forms, location } = state;
        return [
            hostPools,
            forms[this.formName],
            location.params.system
        ];
    }

    mapStateToProps(hostPools, form, system) {
        if (!hostPools || !form) {
            return;
        }

        const { targetPool, excludedDrives } =  getFormValues(form);
        const hostPoolsHref = realizeUri(routes.resources, { system, tab: 'pools' });
        const poolOptions = Object.values(hostPools)
            .sort(_compareByCreationTime)
            .map(pool => {
                if (pool.mode === 'BEING_CREATED') {
                    return {
                        value: pool.name,
                        label: `Creating pool (${pool.name})`,
                        icon: 'in-progress',
                        disabled: true
                    };
                } else {
                    return {
                        value: pool.name,
                        icon: 'nodes-pool'
                    };
                }
            });

        ko.assignToProps(this, {
            poolOptions,
            targetPool,
            excludedDrives,
            isStepValid: isFormValid(form),
            hostPoolsHref
        });
    }

    onValidate(values) {
        const errors = {};
        const { step, targetPool } = values;

        if (step === 0) {
            if (!targetPool) {
                errors.targetPool = 'Please select a pool from the list';
            }
        }

        return errors;
    }

    onBeforeStep(step) {
        if (!this.isStepValid) {
            this.dispatch(touchForm(this.formName, ['targetPool']));
            return false;

        } else {
            if (step === 1) {
                // If moving to last step, fetch the intallation commands.
                this.dispatch(fetchNodeInstallationCommands(
                    this.targetPool,
                    this.excludedDrives
                ));
            }

            return true;
        }
    }

    onCreateNewPool() {
        this.dispatch(openCreateEmptyPoolModal());
    }

    onDone() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: InstallNodeModalViewModel,
    template: template
};
