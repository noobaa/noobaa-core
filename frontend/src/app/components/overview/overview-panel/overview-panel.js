import template from './overview-panel.html';
import ko from 'knockout';
import { formatSize } from 'utils';
import numeral from 'numeral';
import { systemSummary, routeContext } from 'model';
import { redirectTo } from 'actions';

class OverviewPanelViewModel {
	constructor() {
		this.isReady = ko.pureComputed(
			() => !!systemSummary()
		);

		this.systemCapacity = ko.pureComputed(
			() => formatSize(systemSummary().capacity)
		);

		this.onlineNodeCount = ko.pureComputed(
			() => numeral(systemSummary().onlineNodeCount).format('0,0')
		);

		this.offlineNodeCount = ko.pureComputed(
			() => numeral(systemSummary().offlineNodeCount).format('0,0')
		);

		this.poolCount = ko.pureComputed(
			() => numeral(systemSummary().poolCount).format('0,0')
		);

		this.nodeCount = ko.pureComputed(
			() => numeral(systemSummary().nodeCount).format('0,0')
		);

		this.bucketCount = ko.pureComputed(
			() => numeral(systemSummary().bucketCount).format('0,0')
		);

		this.objectCount = ko.pureComputed(
			() => numeral(systemSummary().objectCount).format('0,0')
		);

		this.isInstallNodeWizardlVisible = ko.observable(false);
		this.isConnectAppWizardVisible = ko.observable(false);
		
		this.isAfterUpgradeModalVisible = ko.pureComputed(
			() => !!routeContext().query.afterupgrade
		);
	}

	closeAfterUpgradeModal() {
		redirectTo('/fe/systems/:system')
	}
	
}

export default { 
	viewModel: OverviewPanelViewModel,
	template: template
}
