import template from './node-panel.html';
import ko from 'knockout';

class NodePanelViewModel {
	constructor() {
		this.selectedTab = ko.observable('file-parts');
	}

	isTabsSelected(tabName) {
		return this.selectedTab() === tabName;
	}	
}

export default {
	viewModel: NodePanelViewModel,
	template: template 
}