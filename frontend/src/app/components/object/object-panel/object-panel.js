import template from './object-panel.html';
import ko from 'knockout';
import { uiState, objectInfo, objectPartList } from 'model';

class ObjectPanelViewModel {
	constructor() {
		this.object = objectInfo;
		this.parts  = objectPartList;

		this.ready = ko.pureComputed(
			() => !!this.object()
		)

		this.selectedTab = ko.pureComputed(
			() => uiState().tab
		);
	}
}

export default {
	viewModel: ObjectPanelViewModel,
	template: template
}