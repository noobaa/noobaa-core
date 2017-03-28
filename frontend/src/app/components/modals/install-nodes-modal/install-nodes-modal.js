import template from './install-nodes-modal.html';
import FormViewModel from 'components/form-view-model';
import state$ from 'state';
import { deepFreeze } from 'utils/core-utils';
import ko from 'knockout';
import { fetchNodeInstallationCommands } from 'dispatchers';

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

class InstallNodeWizardViewModel extends FormViewModel {
    constructor({ onClose }) {
        super('installNodes');

        this.steps = steps;
        this.osTypes = osTypes;
        this.drivesInputPlaceholder = drivesInputPlaceholder;
        this.onClose = onClose;
        this.pools = ko.observable();

        this.initialize({
            step: 0,
            targetPool: undefined,
            excludeDrives: false,
            excludedDrives: [],
            selectedOs: 'LINUX',
            commands: { LINUX: '', WINDOWS: '' }
        });

        this.observe(state$.get('nodePools'), this.onPools);
    }

    onPools(pools) {
        this.pools(Object.keys(pools));
    }

    onForm(form) {
        super.onForm(form);
    }

    validate(form) {
        let errors = {};

        const { step, targetPool } = form;
        if (step === 0 && !targetPool) {
            errors.targetPool = 'Please select a nodes pool';
        }

        return { errors };
    }

    onTab(os) {
        this.update('selectedOs', os);
    }

    onNext(next) {
        if (!this.valid()) {
            this.touchAll();
            return;
        }

        if (next === 2) {
            const { targetPool, excludeDrives, excludedDrives } = this;
            fetchNodeInstallationCommands(
                targetPool(),
                excludeDrives() ? excludedDrives() : []
            );
        }

        this.update('step', next);
    }

    onPrev(prev) {
        this.update('step', prev);
        this.resetField('commands');
    }
}

export default {
    viewModel: InstallNodeWizardViewModel,
    template: template
};
