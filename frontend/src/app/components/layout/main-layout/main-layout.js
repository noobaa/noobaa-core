import template from './main-layout.html';
import ko from 'knockout';
import { uiState } from 'model';

class MainLayoutViewModel {
	constructor() {
		this.panel = ko.pureComputed(
			() => `${uiState().panel}-panel`
		);
	}
}

export default {
	viewModel: MainLayoutViewModel,
	template: template
}