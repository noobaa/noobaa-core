import template from './header.html';
import ko from 'knockout';
import { appState } from 'stores';

class HeaderViewModel {
	constructor() {
		this.heading = ko.pureComputed(
			() => appState().heading 
		);

		this.breadcrumbs = ko.pureComputed(
			() => appState().breadcrumbs
		);
	}
}

export default { 
	viewModel: HeaderViewModel,
	template: template
}
