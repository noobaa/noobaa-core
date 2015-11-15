import template from './panel-manager.html';
import ko from 'knockout';
import { appState } from 'stores';

class PanelManagerViewModel {
	constructor() {
		this.panelName = ko.pureComputed(
			() => `${appState().panel}-panel`
		);
	}
}

export default {
	viewModel: PanelManagerViewModel,
	template: template
}