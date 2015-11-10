import template from './panel-manager.html';
import ko from 'knockout';
import { appState } from 'shared-streams';

class PanelManagerViewModel {
	constructor() {
		this.panelName = appState
			.pluck('params', 'panel')
			.map(panel => panel ? `${panel}-panel` : '')
			.toKO();
	}
}

export default {
	viewModel: PanelManagerViewModel,
	template: template
}