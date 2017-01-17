import template from './install-node-modal.html';
import networkInstallationTemplate from './network-installation.html';
import manualInstallationTemplate from './manual-installation.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { lastSegment } from 'utils/string-utils';
import {  encodeBase64 } from 'utils/browser-utils';

function getInstallationCommand(os, { pkg, conf, server }) {
    switch(`${os}`) {
        case 'linux':
            return `wget ${server}:8080/public/${pkg} && chmod 755 ${pkg} && ./${pkg} /S /config ${conf}`;

        case 'windows':
            return `Import-Module BitsTransfer ; Start-BitsTransfer -Source http://${server}:8080/public/${pkg} -Destination C:\\${pkg}; C:\\${pkg} /S /config ${conf}`;
    }
}

class InstallNodeWizardViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.networkInstallationTemplate = networkInstallationTemplate;
        this.manualInstallationTemplate = manualInstallationTemplate;

        this.onClose = onClose;
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
                this.selectedOsType(),
                {
                    pkg: lastSegment(this.packageUrl(), '/'),
                    conf: agentConf(),
                    server: serverAddress()
                }
            )
        );
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: InstallNodeWizardViewModel,
    template: template
};
