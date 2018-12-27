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
    updateForm,
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

const osTypes = deepFreeze([
    {
        value: 'LINUX',
        label: 'Linux',
        hint: 'Run using a privileged user'
    },
    {
        value: 'WINDOWS',
        label: 'Windows',
        hint: 'Run using PowerShell'
    }
]);

const drivesInputPlaceholder =
    `e.g., /mnt or c:\\ and click enter ${String.fromCodePoint(0x23ce)}`;

const _compareByCreationTime = createCompareFunc(pool => pool.creationTime, -1);

class InstallNodeModalViewModel extends ConnectableViewModel {
    learnMoreHref = learnMoreHref;
    formName = this.constructor.name;
    steps = steps;
    osTypes = osTypes;
    drivesInputPlaceholder = drivesInputPlaceholder;
    poolActions = [{
        label: 'Create new pool',
        onClick: this.onCreateNewPool.bind(this)
    }];
    poolOptions = ko.observableArray();
    osHint = ko.observable();
    hostPoolsHref = ko.observable();
    targetPool = '';
    excludeDrives = [];
    isStepValid = false;
    fields = {
        step: 0,
        targetPool: '',
        poolName: '',
        excludeDrives: false,
        excludedDrives: [],
        selectedOs: 'LINUX',
        commands: {
            LINUX: '',
            WINDOWS: ''
        }
    };

    selectState(state) {
        return [
            state.hostPools,
            state.forms[this.formName],
            state.location.params.system
        ];
    }

    mapStateToProps(hostPools, form, system) {
        if (!hostPools || !form) {
            return;
        }

        const { targetPool, selectedOs, excludedDrives } =  getFormValues(form);
        const { hint } = this.osTypes.find(os => os.value === selectedOs);
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
            osHint: hint,
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
            this.dispatch(touchForm(this.formName, ['targetPool', 'poolName']));
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

    onTab(osType) {
        this.dispatch(updateForm(this.formName, { selectedOs: osType }));
    }

    onDone() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: InstallNodeModalViewModel,
    template: template
};
