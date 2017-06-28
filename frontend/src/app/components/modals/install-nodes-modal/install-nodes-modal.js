/* Copyright (C) 2016 NooBaa */

import template from './install-nodes-modal.html';
import Observer from 'observer';
import FormViewModel from 'components/form-view-model';
import { state$, dispatch } from 'state';
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
        label: 'Linux'
    },
    {
        value: 'WINDOWS',
        label: 'Windows'
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
            onValidate: this.onValidate
        });

        this.observe(
            state$.get('nodePools'),
            this.onPools
        );
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
        const { form } = this;

        if (!form.isValid()) {
            form.touch(step);
            return false;
        }

        if (step === 1) {
            // If moving to last step, fetch the intallation commands.
            dispatch(fetchNodeInstallationCommands(
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
