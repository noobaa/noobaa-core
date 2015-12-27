import template from './overview-panel.html';
import ko from 'knockout';
import { isDefined } from 'utils';
import numeral from 'numeral';
import { systemOverview } from 'model';

class OverviewPanelViewModel {
	constructor() {
		this.ready = ko.pureComputed(
			() => isDefined(systemOverview())
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
