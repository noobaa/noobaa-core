import template from './pools-panel.html';
import ko from 'knockout';
import { poolList } from 'model';

class PoolsPanelViewModel {
	constructor() {
		this.pools = poolList;
		this.isCreatePoolWizardVisible = ko.observable(true);
	}
}

export default {
	viewModel: PoolsPanelViewModel,
	template: template,
}