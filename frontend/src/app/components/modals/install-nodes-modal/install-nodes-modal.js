/* Copyright (C) 2016 NooBaa */

import template from './install-nodes-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getFieldValue, isFormValid } from 'utils/form-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import { getMany } from 'rx-extensions';
import { installNodes as learnMoreHref } from 'knowledge-base-articles';
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
    },
    {
        value: 'KUBERNETES',
        label: 'Kubernetes',
        hint: 'Copy into a noobaa.yaml file and run using the command "kubectl apply -f noobaa.yaml"'
    }
]);

const drivesInputPlaceholder =
    `e.g., /mnt or c:\\ and click enter ${String.fromCodePoint(0x23ce)}`;


class InstallNodeModalViewModel extends Observer {
    learnMoreHref = learnMoreHref;
    formName = this.constructor.name;
    steps = steps;
    osTypes = osTypes;
    drivesInputPlaceholder = drivesInputPlaceholder;
    poolOptions = ko.observable();
    osHint = ko.observable();
    hostPoolsHref = ko.observable();
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
            WINDOWS: '',
            KUBERNETES: ''
        }
    };

    constructor() {
        super();

        this.observe(
            state$.pipe(getMany(
                'hostPools',
                ['forms', this.formName],
                ['location', 'params', 'system']
            )),
            this.onState
        );
    }

    onState([hostPools, form, system]) {
        if (!hostPools || !form) {
            return;
        }

        const selectedOs = getFieldValue(form, 'selectedOs');
        const { hint } = this.osTypes.find(os => os.value === selectedOs);
        const poolOptions = Object.keys(hostPools);
        const hostPoolsHref = realizeUri(routes.resources, { system, tab: 'pools' });

        this.osHint(hint);
        this.poolOptions(poolOptions);
        this.targetPool = getFieldValue(form, 'targetPool');
        this.excludedDrives = getFieldValue(form, 'excludedDrives');
        this.isStepValid = isFormValid(form);
        this.hostPoolsHref(hostPoolsHref);
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
