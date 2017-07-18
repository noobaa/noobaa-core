/* Copyright (C) 2016 NooBaa */

import template from './install-nodes-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, action$ } from 'state';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { fetchNodeInstallationCommands } from 'action-creators';

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


const formName = 'installNodes';

class InstallNodeWizardViewModel extends Observer {
    constructor({ onClose }) {
        super();

        this.close = onClose;
        this.steps = steps;
        this.osTypes = osTypes;
        this.drivesInputPlaceholder = drivesInputPlaceholder;
        this.poolOptions = ko.observable();
        this.osHint = ko.observable();
        this.form = new FormViewModel({
            name: formName,
            fields: {
                step: 0,
                targetPool: '',
                excludeDrives: false,
                excludedDrives: [],
                selectedOs: 'LINUX',
                commands: {
                    LINUX: '',
                    WINDOWS: ''
                }
            },
            groups: {
                0: ['targetPool']
            },
            onValidate: this.onValidate,
            onForm: this.onForm.bind(this)
        });

        this.observe(state$.get('hostPools', 'items'), this.onPools);
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

    onForm({ fields })  {
        const { value: selectedOs } = fields.selectedOs;
        const { hint } = osTypes.find(os => os.value === selectedOs);
        this.osHint(hint);
    }

    onBeforeStep(step) {
        const { form } = this;

        if (!form.isValid()) {
            form.touch(step);
            return false;
        }

        if (step === 1) {
            // If moving to last step, fetch the intallation commands.
            action$.onNext(fetchNodeInstallationCommands(
                form.targetPool(),
                form.excludedDrives()
            ));
        }

        return true;
    }

    onTab(osType) {
        this.form.selectedOs(osType);
    }

    onPools(pools) {
        this.poolOptions(Object.keys(pools));
    }

    onDone() {
        this.close();
    }

    dispose() {
        this.form.dispose();
        super.dispose();
    }
}

export default {
    viewModel: InstallNodeWizardViewModel,
    template: template
};
