import template from './overview-panel.html';
import ko from 'knockout';
import { systemInfo } from 'stores';

let undefined;

class OverviewPanelViewModel {
	constructor() {
		this.ready = ko.pureComputed(
			() => systemInfo() !== undefined
		);

		// TODO: Need to change to ko.unwrap(systemInfo).pools.length when avaliable.
		this.poolCount = ko.pureComputed(
			() => 1
		);

		this.nodeCount = ko.pureComputed(
			() => systemInfo().nodes.count
		);

		this.bucketCount = ko.pureComputed(
			() => systemInfo().buckets.length
		);

		this.objectCount = ko.pureComputed(
			() => systemInfo().objects
		);

		this.showAddNodeModal = false;
		this.showRestDetailsModal = false;
	}
}

export default { 
	viewModel: OverviewPanelViewModel,
	template: template
}
