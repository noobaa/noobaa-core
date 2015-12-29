import template from './pool-panel.html';
import ko from 'knockout';
import { poolInfo, poolNodeList } from 'model';

class PoolPanelViewModel {
	constructor() {
		this.pool = poolInfo;
		this.nodes = poolNodeList;

		this.ready = ko.pureComputed(
			() => !!this.pool()
		);
	}

	isTabSelected(name) {
		return true;
	}
}

export default {
	viewModel: PoolPanelViewModel,
	template: template
}