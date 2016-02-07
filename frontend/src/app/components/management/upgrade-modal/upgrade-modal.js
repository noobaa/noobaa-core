import template from './upgrade-modal.html';
import ko from 'knockout';
import numeral from 'numeral';
import { makeArray } from 'utils';
import { upgradeStatus } from 'model';

class UpgradeModalViewModel {
	constructor({ onClose }) {
		this.onClose = onClose;

		let step = ko.pureComputed(
			() => upgradeStatus() && upgradeStatus().step
		);

		let progress = ko.pureComputed(
			() => upgradeStatus() ? upgradeStatus().progress : 0
		);

		this.upgradeFailed = ko.pureComputed(
			() => !!upgradeStatus() && upgradeStatus().state === 'FAILED'
		);

		this.stepClass = ko.pureComputed(
			() => (step() || '').toLowerCase() 
		);

		this.progressText = ko.pureComputed(
			() => step() === 'UPLOAD' ?
				`Uploading Package ${numeral(progress()).format('0%')}` :
				'Installing Package...'
		);

		this.noobaas = makeArray(
			10, 
			i => ko.pureComputed(
				() =>  step() === 'UPLOAD' ?
					(i === 0 ? true : !!(progress() * 10 / (i) | 0)) :
					true
			)
		);		
	}

	close() {
		if (this.upgradeFailed()) {
			this.onClose();
		}
	}
}

export default {
	viewModel: UpgradeModalViewModel,
	template: template
}