import template from './about-form.html';
import ko from 'knockout';
import { systemInfo } from 'model';


class AboutFormViewModel {
	constructor() {
		this.version = ko.pureComputed(
			() => systemInfo() && systemInfo().version 
		);
	}

	upgrade() {
		
	}
}

export default {
	viewModel: AboutFormViewModel,
	template: template
}