import template from './pools-panel.html';
import { poolList } from 'model';

class PoolsPanelViewModel {
	constructor() {
		this.pools = poolList;
	}
}

export default {
	viewModel: PoolsPanelViewModel,
	template: template,
}