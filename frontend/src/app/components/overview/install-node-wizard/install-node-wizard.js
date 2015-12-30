import template from './install-node-wizard.html';
import configureStepTemplate from './configure-step.html';
import downloadStepTemplate from './download-step.html';
import runStepTemplate from './run-step.html';
import reviewStepTemplate from './review-step.html';
import ko from 'knockout';
import { serverAddress } from 'config';

class InstallNodeWizardViewModel {
	constructor({ onClose }) {
		this.configureStepTemplate = configureStepTemplate;
		this.downloadStepTemplate = downloadStepTemplate;
		this.runStepTemplate = runStepTemplate;
		this.reviewStepTemplate = reviewStepTemplate;
		this.onClose = onClose;

		this.addrType = ko.observable('IP');
		this.dnsName = ko.observable();
		
		this.dnsName = ko.observable();
		this.addr = ko.pureComputed(
			() => this.addrType() === 'IP' ? serverAddress : 'noobaa.com'
		);
	}
}

export default {
	viewModel: InstallNodeWizardViewModel,
	template: template
}
