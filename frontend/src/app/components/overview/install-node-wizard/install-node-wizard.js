import template from './install-node-wizard.html';
import selectStepTemplate from './select-step.html';
import installStepTemplate from './install-step.html';
import reviewStepTemplate from './review-step.html';
import ko from 'knockout';
import { defaultPoolName } from 'config';
import { agentInstallationInfo as installInfo, systemInfo } from 'model';
import { copyTextToClipboard, lastSegment } from 'utils';
import { loadAgentInstallationInfo } from 'actions';

const installCommands = {
    NETWORK_WINDOWS(pkg, conf, server) {
        return `Invoke-WebRequest ${server}:8080/public/${pkg} -OutFile C:\\${pkg}; C:\\${pkg} ${conf}`
    },

    NETWORK_LINUX(pkg, conf, server) {
        return `wget ${server}:8080/public/${pkg} && chmod 755 ${pkg} && ./${pkg} ${conf}`;
    },

    LOCAL_WINDOWS(pkg, conf) {
        return `${pkg} /S /config ${conf}`; 
    },

    LOCAL_LINUX(pkg, conf) {
        return `${pkg} /S /config ${conf}`; 
    }
};

class InstallNodeWizardViewModel {
    constructor({ onClose }) {
        this.selectStepTemplate = selectStepTemplate;
        this.installStepTemplate = installStepTemplate;
        this.reviewStepTemplate = reviewStepTemplate;
        this.onClose = onClose;

        this.dataReady = ko.pureComputed(
            () => !!installInfo()
        );

        this.installationTypeOptions = [
            { value: 'NETWORK', label: 'Network Installation (recommended)' },
            { value: 'LOCAL', label: 'Local Installation' }
        ];

        this.installationType = ko.observable(
            this.installationTypeOptions[0].value
        );

        this.installationTargetOptions = [
            { value: 'LINUX', label: 'Linux' },
            { value: 'WINDOWS', label: 'Windows' }
        ];

        this.installationTarget = ko.observable(
            this.installationTargetOptions[0].value
        );

        this.commandSelector = ko.pureComputed(
            () => `${this.installationType()}_${this.installationTarget()}`
        );

        this.packageUrl = ko.pureComputed(
            () => ({
                LINUX: installInfo().downloadUris.linux,
                WINDOWS: installInfo().downloadUris.windows
            })[
                this.installationTarget()
            ]
        );

        this.selectedInstallCommand = ko.pureComputed(
            () => {
                let selector = this.commandSelector();
                let pkg = lastSegment(this.packageUrl(), '/');
                let conf = installInfo().agentConf;
                let server = systemInfo().ipAddress;

                return installCommands[selector](pkg, conf, server)
            }
        );

        this.defaultPoolUrl = `/fe/systems/:system/pools/${defaultPoolName}`;

        loadAgentInstallationInfo();
    }

    copyInstallCommand() {
        copyTextToClipboard(
            this.selectedInstallCommand()
        );
    }
}

export default {
    viewModel: InstallNodeWizardViewModel,
    template: template
}
