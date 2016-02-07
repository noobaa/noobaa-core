import template from './about-form.html';
import ko from 'knockout';
import { systemInfo } from 'model';
import { upgradeSystem } from 'actions';


class AboutFormViewModel {
	constructor({ onClose }) {
		this.version = ko.pureComputed(
			() => systemInfo() && systemInfo().version 
		);

		this.isUpgradingModalVisible = ko.observable(false);
	}

	upgrade(upgradePackage) {
		this.isUpgradingModalVisible(true);
		upgradeSystem(upgradePackage);
	}
}

export default {
	viewModel: AboutFormViewModel,
	template: template
}