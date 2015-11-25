import template from './signin-form.html';
import ko from 'knockout';
import { uiState } from 'model';
import { signIn } from 'actions';

class SignInFormViewModel {
	constructor() {
		this.email = ko.observable()
			.extend({ required: true });
		
		this.password = ko.observable()
			.extend({ required: true });

		this.errors = ko.validation.group(this);
	}

	signIn() {
		if (this.errors().length === 0) {
			signIn(this.email(), this.password(), uiState().returnUrl);	

		} else {
			this.errors.showAllMessages();
		}
	}
}

export default {
	viewModel: SignInFormViewModel,
	template: template
}