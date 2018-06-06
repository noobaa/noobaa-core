/* Copyright (C) 2016 NooBaa */

import template from './install-nodes-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getFieldValue, isFormValid } from 'utils/form-utils';
import { getMany } from 'rx-extensions';
import {
    updateForm,
    touchForm,
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


class InstallNodeModalViewModel extends Observer {
    formName = this.constructor.name;
    steps = steps;
    osTypes = osTypes;
    drivesInputPlaceholder = drivesInputPlaceholder;
    poolOptions = ko.observable();
    osHint = ko.observable();
    targetPool = '';
    excludeDrives = [];
    isStepValid = false;
    fields = {
        step: 0,
        targetPool: '',
        excludeDrives: false,
        excludedDrives: [],
        selectedOs: 'LINUX',
        commands: {
            LINUX: '',
            WINDOWS: ''
        }
    };

    constructor() {
        super();

        this.observe(
            state$.pipe(getMany(
                'hostPools',
                ['forms', this.formName]
            )),
            this.onState
        );
    }

    onState([hostPools, form]) {
        if (!hostPools || !form) {
            return;
        }

        const selectedOs = getFieldValue(form, 'selectedOs');
        const { hint } = this.osTypes.find(os => os.value === selectedOs);
        const poolOptions = Object.keys(hostPools);

        this.osHint(hint);
        this.poolOptions(poolOptions);
        this.targetPool = getFieldValue(form, 'targetPool');
        this.excludedDrives = getFieldValue(form, 'excludedDrives');
        this.isStepValid = isFormValid(form);
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
            action$.next(touchForm(this.formName, ['targetPool']));
            return false;
        }

        if (step === 1) {
            // If moving to last step, fetch the intallation commands.
            action$.next(fetchNodeInstallationCommands(
                this.targetPool,
                this.excludedDrives
            ));
        }

        return true;
    }

    onTab(osType) {
        action$.next(updateForm(this.formName, { selectedOs: osType }));
    }

    onDone() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: InstallNodeModalViewModel,
    template: template
};
