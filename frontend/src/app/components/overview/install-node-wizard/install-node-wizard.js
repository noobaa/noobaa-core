import template from './install-node-wizard.html';
import selectStepTemplate from './select-step.html';
import installStepTemplate from './install-step.html';
import reviewStepTemplate from './review-step.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { defaultPoolName } from 'config';
import { systemInfo } from 'model';
import { copyTextToClipboard, lastSegment, realizeUri, encodeBase64 } from 'utils';
import { asset as assetRoute } from 'routes';

const installCommands = Object.freeze({
    NETWORK_WINDOWS(pkg, conf, server) {
        return `Invoke-WebRequest ${server}:8080/public/${pkg} -OutFile C:\\${pkg}; C:\\${pkg} /S /config ${conf}`;
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
});

const installationTypeOptions = Object.freeze([
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
]);

const installationTargetOptions = Object.freeze([
    {
        value: 'LINUX',
        label: 'Linux'
    },
    {
        value: 'WINDOWS',
        label: 'Windows'
    }
]);

class InstallNodeWizardViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.selectStepTemplate = selectStepTemplate;
        this.installStepTemplate = installStepTemplate;
        this.reviewStepTemplate = reviewStepTemplate;
        this.onClose = onClose;

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
            () => {
                if (!systemInfo()) {
                    return;
                }

                return {
                    'LINUX': systemInfo().web_links.linux_agent_installer,
                    'WINDOWS': systemInfo().web_links.agent_installer
                }[
                    this.installationTarget()
                ];
            }
        );

        let agentConf = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return;
                }

                let { access_key, secret_key } = systemInfo().owner.access_keys;
                return encodeBase64({
                    address: systemInfo().base_address,
                    system: systemInfo().name,
                    access_key: access_key,
                    secret_key: secret_key,
                    tier: 'nodes',
                    root_path: './agent_storage/'
                });
            }
        );

        this.selectedInstallCommand = ko.pureComputed(
            () => installCommands[this.commandSelector()](
                lastSegment(this.packageUrl(), '/'),
                agentConf(),
                systemInfo().ip_addresss
            )
        );

        this.defaultPool = defaultPoolName;

        this.nodeListImageUrl = realizeUri(
            assetRoute,
            { asset: 'nodesList_illustration.png' }
        );
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
};
