/* Copyright (C) 2016 NooBaa */

import template from './install-nodes-to-pool-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getFieldValue } from 'utils/form-utils';
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
        hint: 'Copy into a noobaa.yaml file and run using the command "kubectl apply -f noobaa.yaml"'
    }
]);

const drivesInputPlaceholder =
    `e.g., /mnt or c:\\ and click enter ${String.fromCodePoint(0x23ce)}`;


class InstallNodeModalViewModel extends ConnectableViewModel {
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

    selectState(state, params) {
        const { forms } = state;
        return [
            forms && forms[this.formName],
            params.targetPool
        ];
    }

    mapStateToProps(form, targetPool) {
        if (!form) {
            return;
        }

        const selectedOs = getFieldValue(form, 'selectedOs');
        const { hint } = osTypes.find(os => os.value === selectedOs);

        ko.assignToProps(this, {
            targetPool,
            osHint: hint,
            excludedDrives: getFieldValue(form, 'excludedDrives')
        });
    }

    onBeforeStep(step) {
        if (step === 0) {
            // If moving to last step, fetch the intallation commands.
            this.dispatch(fetchNodeInstallationCommands(
                this.targetPool,
                this.excludedDrives
            ));
        }

        return true;
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
