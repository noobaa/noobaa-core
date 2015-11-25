import template from './node-panel.html';
import ko from 'knockout';
import { uiState, nodeInfo, nodeObjectList } from 'model';

class NodePanelViewModel {
	constructor() {
		this.node = nodeInfo;
		this.objects = nodeObjectList;
		this.selectedTab = ko.pureComputed(
			() => uiState().tab
		);
	}
}

export default {
	viewModel: NodePanelViewModel,
	template: template 
}