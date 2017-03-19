import template from './install-nodes-modal.html';
import FormViewModel from 'components/form-view-model';
import { deepFreeze } from 'utils/core-utils';
import ko from 'knockout';
import { fetchNodeInstallationCommand } from 'dispatchers';

const steps = deepFreeze([
    'Configure',
    'Install'
]);

const osTypeOptions = deepFreeze([
    {
        value: 'LINUX',
        label: 'linux'
    },
    {
        value: 'WINDOWS',
        label: 'windows'
    }
]);

class InstallNodeWizardViewModel extends FormViewModel {
    constructor({ onClose }) {
        super('installNodes');

        this.steps = steps;
        this.osTypeOptions = osTypeOptions;
        this.onClose = onClose;
        this.step = ko.observable();
        this.osType = ko.observable();
        this.excludeDrives = ko.observable();
        this.excludedDrives = ko.observable();
        this.command = ko.observable();
        this.subject = ko.observable();
        this.tokensPlaceholder = ko.observable();
        this.userInstruction = ko.observable();
    }

    onState(form) {
        if (!form) {
            this.initializeForm({
                step: 0,
                osType: 'LINUX',
                excludeDrives: false,
                excludedDrives: [],
                command: ''
            });

        } else {
            this.copyFormValuesToProps(form);

            if (this.osType() === 'LINUX') {
                this.subject('mount');
                this.tokensPlaceholder('Type mounts here (e.g. /mnt/mydata)');
                this.userInstruction('Open a linux shell to a target  machine and run the following command');

            } else if (this.osType() === 'WINDOWS') {
                this.subject('drive');
                this.tokensPlaceholder('Type drives here (e.g. c:\\)');
                this.userInstruction('Open an elevated Powershell (run as administrator) to a target machine and run the following command');
            }
        }
    }

    onNext() {
        const { step, command , osType, excludeDrives, excludedDrives } = this;

        if (step() === 0 && !command()) {
            const drives = excludeDrives() ? excludedDrives() : [];
            fetchNodeInstallationCommand(osType(), drives);
        }

        this.updateForm('step', step() + 1);
    }
}

export default {
    viewModel: InstallNodeWizardViewModel,
    template: template
};
