import template from './pool-panel.html';
import { poolInfo } from 'model';

class PoolPanelViewModel {
	constructor() {
		this.pool = poolInfo;
	}

	isTabSelected(name) {
		return true;
	}
}

export default {
	viewModel: PoolPanelViewModel,
	template: template
}