import template from './pool-panel.html';
import ko from 'knockout';
import { poolInfo } from 'model';

class PoolPanelViewModel {
	constructor() {
		this.pool = poolInfo;

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