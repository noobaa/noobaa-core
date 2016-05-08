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
        return `Invoke-WebRequest ${server}:8080/public/${pkg} -OutFile C:\\${pkg}; C:\\${pkg} /S /config ${conf}`
    },

    NETWORK_LINUX(pkg, conf, server) {
        return `wget ${server}:8080/public/${pkg} && chmod 755 ${pkg} && ./${pkg} /S /config ${conf}`;
    },

    LOCAL_WINDOWS(pkg, conf) {
        return `${pkg} /S /config ${conf}`; 
    },

    LOCAL_LINUX(pkg, conf) {
        return `${pkg} /S /config ${conf}`; 
    }
};

const installationTypeOptions = [
    { 
        value: 'NETWORK', 
        label: 'Network Installation (recommended)',
        description: 'Choose this option to use NooBaa\'s distribution utilities to install the NooBaa daemon over the network. This option require direct access from the target machine to the NooBaa server'
    },
    { 
        value: 'LOCAL', 
        label: 'Local Installation',
        description: 'Choose this option when your target machine does not have direct access to the NooBaa server'
    }
];

const installationTargetOptions = [
    { 
        value: 'LINUX', 
        label: 'Linux' 
    },
    { 
        value: 'WINDOWS', 
        label: 'Windows' 
    }
];

class InstallNodeWizardViewModel {
    constructor({ onClose }) {
        this.selectStepTemplate = selectStepTemplate;
        this.installStepTemplate = installStepTemplate;
        this.reviewStepTemplate = reviewStepTemplate;
        this.onClose = onClose;

        this.dataReady = ko.pureComputed(
            () => !!installInfo()
        );

        this.installationTypeOptions = installationTypeOptions;
        this.installationType = ko.observable(
            installationTypeOptions[0].value
        );

        this.installationTargetOptions = installationTargetOptions;
        this.installationTarget = ko.observable(
            installationTargetOptions[0].value
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
