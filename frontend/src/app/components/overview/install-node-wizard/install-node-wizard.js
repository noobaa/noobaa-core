import template from './install-node-wizard.html';
import downloadStepTemplate from './download-step.html';
import runStepTemplate from './run-step.html';
import reviewStepTemplate from './review-step.html';
import ko from 'knockout';
import { defaultPoolName } from 'config';
import { agentInstallationInfo as installInfo } from 'model';
import { copyTextToClipboard } from 'utils';
import { loadAgentInstallationInfo } from 'actions';

class InstallNodeWizardViewModel {
    constructor({ onClose }) {
        this.downloadStepTemplate = downloadStepTemplate;
        this.runStepTemplate = runStepTemplate;
        this.reviewStepTemplate = reviewStepTemplate;
        this.onClose = onClose;
        this.installationType = ko.observable('DIST_TOOL');

        this.dataReady = ko.pureComputed(
            () => !!installInfo()
        );

        this.windowAgentUrl = ko.pureComputed(
            () => installInfo().downloadUris.windows
        );

        this.linuxAgentUrl = ko.pureComputed(
            () => installInfo().downloadUris.linux
        );

        this.distConf = ko.pureComputed(
            () => `/S /config ${installInfo().agentConf}` 
        );

        this.windowsInstallCommand = ko.pureComputed(
             () => `${this._extractAgentName(this.windowAgentUrl())} ${this.distConf()}`
        );

        this.linuxInstallCommand = ko.pureComputed(
             () => `${this._extractAgentName(this.linuxAgentUrl())} ${this.distConf()}`
        );

        this.defaultPoolUrl = `/fe/systems/:system/pools/${defaultPoolName}`;

        loadAgentInstallationInfo();
    }

    copyToClipboard(text) {
        copyTextToClipboard(ko.unwrap(text));
    }

    _extractAgentName(url) {
        return url.substr(url.lastIndexOf('/') + 1);
    }
}

export default {
    viewModel: InstallNodeWizardViewModel,
    template: template
}
