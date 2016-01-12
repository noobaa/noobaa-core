import template from './overview-panel.html';
import ko from 'knockout';
import { formatSize } from 'utils';
import numeral from 'numeral';
import { systemOverview } from 'model';

class OverviewPanelViewModel {
	constructor() {
		this.isReady = ko.pureComputed(
			() => !!systemOverview()
		);

		this.systemCapacity = ko.pureComputed(
			() => formatSize(systemOverview().capacity)
		);

		this.onlineNodeCount = ko.pureComputed(
			() => numeral(systemOverview().onlineNodeCount).format('0,0')
		);

		this.offlineNodeCount = ko.pureComputed(
			() => numeral(systemOverview().offlineNodeCount).format('0,0')
		);

		this.poolCount = ko.pureComputed(
			() => numeral(systemOverview().poolCount).format('0,0')
		);

		this.nodeCount = ko.pureComputed(
			() => numeral(systemOverview().nodeCount).format('0,0')
		);

		this.bucketCount = ko.pureComputed(
			() => numeral(systemOverview().bucketCount).format('0,0')
		);

		this.objectCount = ko.pureComputed(
			() => numeral(systemOverview().objectCount).format('0,0')
		);

		this.isInstallNodeWizardlVisible = ko.observable(false);
		this.isConnectAppWizardVisible = ko.observable(false);
	}
}

export default { 
	viewModel: OverviewPanelViewModel,
	template: template
}
