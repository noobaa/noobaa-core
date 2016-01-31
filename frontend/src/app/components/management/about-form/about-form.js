import template from './about-form.html';
import ko from 'knockout';
import numeral from 'numeral';
import { makeArray } from 'utils';
import { systemInfo, upgradeStatus } from 'model';
import { upgradeSystem } from 'actions';


class AboutFormViewModel {
	constructor() {
		this.version = ko.pureComputed(
			() => systemInfo() && systemInfo().version 
		);

		this.isUpgradingModalVisible = ko.observable(false)

		let upgradeProgress = ko.pureComputed(
			() => upgradeStatus() ? upgradeStatus().uploadProgress : 0
		);

		this.progressText = ko.pureComputed(
			() => numeral(upgradeProgress()).format('0%')
		);

		this.progressSteps = makeArray(
			10, 
			i => ko.pureComputed(
				() =>  i === 0 ? true : !!(upgradeProgress() * 10 / (i) | 0)
			)
		);
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