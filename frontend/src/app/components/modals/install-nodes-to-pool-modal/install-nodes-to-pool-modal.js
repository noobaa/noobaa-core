/* Copyright (C) 2016 NooBaa */

import template from './install-nodes-to-pool-modal.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { getFieldValue } from 'utils/form-utils';
import {
    fetchNodeInstallationCommands,
    closeModal
} from 'action-creators';

const steps = deepFreeze([
    'Select Drives',
    'Install'
]);

const drivesInputPlaceholder =
    `e.g., /mnt or c:\\ and click enter ${String.fromCodePoint(0x23ce)}`;


class InstallNodeModalViewModel extends ConnectableViewModel {
    formName = this.constructor.name;
    steps = steps;
    targetPool = '';
    drivesInputPlaceholder = drivesInputPlaceholder;
    targetPool = '';
    excludeDrives = [];
    fields = {
        step: 0,
        excludeDrives: false,
        excludedDrives: [],
        command: ''
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

        ko.assignToProps(this, {
            targetPool,
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

    onDone() {
        this.dispatch(closeModal());
    }
}

export default {
    viewModel: InstallNodeModalViewModel,
    template: template
};
