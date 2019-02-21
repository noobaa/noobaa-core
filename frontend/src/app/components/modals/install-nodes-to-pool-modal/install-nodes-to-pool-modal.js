/* Copyright (C) 2016 NooBaa */

import template from './install-nodes-to-pool-modal.html';
import Observer from 'observer';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getFieldValue } from 'utils/form-utils';
import { get } from 'rx-extensions';
import {
    updateForm,
    fetchNodeInstallationCommands,
    closeModal
} from 'action-creators';

const steps = deepFreeze([
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
        hint: 'Copy into a noobaa.yaml file and run using the command "kubectl create -f noobaa.yaml"'
    }
]);

const drivesInputPlaceholder =
    `e.g., /mnt or c:\\ and click enter ${String.fromCodePoint(0x23ce)}`;


class InstallNodeModalViewModel extends Observer {
    formName = this.constructor.name;
    steps = steps;
    osTypes = osTypes;
    targetPool = '';
    drivesInputPlaceholder = drivesInputPlaceholder;
    osHint = ko.observable();
    targetPool = '';
    excludeDrives = [];
    fields = {
        step: 0,
        excludeDrives: false,
        excludedDrives: [],
        selectedOs: 'LINUX',
        commands: {
            LINUX: '',
            WINDOWS: '',
            KUBERNETES: ''
        }
    };

    constructor({ targetPool }) {
        super();

        this.targetPool = ko.unwrap(targetPool);

        this.observe(
            state$.pipe(
                get('forms', this.formName)
            ),
            this.onState
        );
    }

    onState(form) {
        if (!form) return;

        const selectedOs = getFieldValue(form, 'selectedOs');
        const { hint } = this.osTypes.find(os => os.value === selectedOs);

        this.osHint(hint);
        this.excludedDrives = getFieldValue(form, 'excludedDrives');
    }

    onBeforeStep(step) {
        if (step === 0) {
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
