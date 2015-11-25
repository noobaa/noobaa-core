import template from './modal.html';
import ko from 'knockout';
import { isDefined } from 'utils'

class ModalViewModel {
	constructor(params) {
		this.visible = ko.pureComputed(() => {
			let visible = ko.unwrap(params.visible);
			return isDefined(visible) ? visible : true; 
		});
	}
}

export default {
	viewModel: ModalViewModel,
	template: template
}

