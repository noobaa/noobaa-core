import template from './install-node-modal.html';
import networkInstallationTemplate from './network-installation.html';
import manualInstallationTemplate from './manual-installation.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { systemInfo } from 'model';
import { lastSegment } from 'utils/string-utils';
import {  encodeBase64 } from 'utils/browser-utils';

function getInstallationCommand(mode, os, { pkg, conf, server }) {
    switch(`${mode}:${os}`) {
        case 'network:linux':
            return `wget ${server}:8080/public/${pkg} && chmod 755 ${pkg} && ./${pkg} /S /config ${conf}`;

        case 'network:windows':
            return `Import-Module BitsTransfer ; Start-BitsTransfer -Source http://${server}:8080/public/${pkg} -Destination C:\\${pkg}; C:\\${pkg} /S /config ${conf}`;

        case 'manual:linux':
            return `${pkg} /S /config ${conf}`;

        case 'manual:windows':
            return `${pkg} /S /config ${conf}`;
    }
}

class InstallNodeWizardViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.networkInstallationTemplate = networkInstallationTemplate;
        this.manualInstallationTemplate = manualInstallationTemplate;

        this.onClose = onClose;
        this.installationMode = ko.observable('network');
        this.osTypeOptions = [ 'linux', 'windows' ];
        this.selectedOsType = ko.observable(this.osTypeOptions[0]);

        this.packageUrl = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return '';
                }

                const { linux_agent_installer, agent_installer } = systemInfo().web_links;
                return this.selectedOsType() === 'linux' ?
                    linux_agent_installer :
                    agent_installer;
            }
        );

        const agentConf = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return '';
                }

                const { access_key, secret_key } = systemInfo().owner.access_keys[0];
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

        const serverAddress = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return '';
                }

                return systemInfo().dns_name ? systemInfo().dns_name : systemInfo().ip_address;
            }
        );

        this.installationCommand = ko.pureComputed(
            () => getInstallationCommand(
                this.installationMode(),
                this.selectedOsType(),
                {
                    pkg: lastSegment(this.packageUrl(), '/'),
                    conf: agentConf(),
                    server: serverAddress()
                }
            )
        );
    }

    toggleInstallationMode() {
        this.installationMode(
            this.installationMode() === 'network' ? 'manual' : 'network'
        );
    }

    close() {
        this.onClose();
    }
}

// class InstallNodeWizardViewModel extends Disposable {
//     constructor({ onClose }) {
//         super();

//         this.steps = steps;
//         this.selectStepTemplate = selectStepTemplate;
//         this.installStepTemplate = installStepTemplate;
//         this.reviewStepTemplate = reviewStepTemplate;
//         this.onClose = onClose;

//         this.installationTypeOptions = installationTypeOptions;
//         this.installationType = ko.observable(
//             installationTypeOptions[0].value
//         );

//         this.installationTargetOptions = installationTargetOptions;
//         this.installationTarget = ko.observable(
//             installationTargetOptions[0].value
//         );

//         this.commandSelector = ko.pureComputed(
//             () => `${this.installationType()}_${this.installationTarget()}`
//         );

//         this.packageUrl = ko.pureComputed(
//             () => {
//                 if (!systemInfo()) {
//                     return;
//                 }

//                 return {
//                     'LINUX': systemInfo().web_links.linux_agent_installer,
//                     'WINDOWS': systemInfo().web_links.agent_installer
//                 }[
//                     this.installationTarget()
//                 ];
//             }
//         );

//         let agentConf = ko.pureComputed(
//             () => {
//                 if (!systemInfo()) {
//                     return;
//                 }

//                 let { access_key, secret_key } = systemInfo().owner.access_keys[0];
//                 return encodeBase64({
//                     address: systemInfo().base_address,
//                     system: systemInfo().name,
//                     access_key: access_key,
//                     secret_key: secret_key,
//                     tier: 'nodes',
//                     root_path: './agent_storage/'
//                 });
//             }
//         );

//         this.selectedInstallCommand = ko.pureComputed(
//             () => installCommands[this.commandSelector()](
//                 lastSegment(this.packageUrl(), '/'),
//                 agentConf(),
//                 systemInfo().dns_name ? systemInfo().dns_name : systemInfo().ip_address
//             )
//         );

//         this.defaultPool = defaultPoolName;

//         this.nodeListImageUrl = realizeUri(
//             assetRoute,
//             { asset: 'nodesList_illustration.png' }
//         );
//     }
// }

export default {
    viewModel: InstallNodeWizardViewModel,
    template: template
};
