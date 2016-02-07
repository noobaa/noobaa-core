import template from './debug-status-bar.html';
import ko from 'knockout';
import moment from 'moment';
import { debugCollectionInfo } from 'model';

class DebugStatusBarViewModel {
	constructor() {
		this.dataReady = ko.pureComputed(
			() => !!debugCollectionInfo()
		);

		this.timeLeft = ko.pureComputed(
			() => debugCollectionInfo() && 
				moment(debugCollectionInfo().timeLeft * 1000).format('mm:ss')
		);

		this.targetName = ko.pureComputed(
			() => debugCollectionInfo() && debugCollectionInfo().targetName
		);

		this.targetHref = ko.pureComputed(
			() => debugCollectionInfo() && debugCollectionInfo().targetHref
		);
	}
}

export default {
	viewModel: DebugStatusBarViewModel,
	template: template
}