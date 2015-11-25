import template from './create-system-form.html';
import ko from 'knockout';
import { createAccount } from 'actions';

class CreateSystemFormViewModel {
	constructor() {
		this.systemName = ko.observable()
			.extend({ required: true, maxLength: 50 });

		this.ownerEmail = ko.observable()
			.extend({ required: true });
		
		this.ownerPassword = ko.observable()
			.extend({ required: true });
	}

	createSystem() {
		createAccount(this.systemName(), this.ownerEmail(), this.ownerPassword());
	}
}

export default {
	viewModel: CreateSystemFormViewModel,
	template: template
}