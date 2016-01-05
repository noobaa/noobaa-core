import template from './signin-form.html';
import ko from 'knockout';
import { uiState, loginInfo } from 'model';
import { signIn } from 'actions';

class SignInFormViewModel {
	constructor() {
		this.email = ko.observable()
			.extend({ 
				required: { message: 'Email address is required' }
			});
		
		this.password = ko.observable()
			.extend({ 
				required: { message: 'Password is required' }
			});

		this.isDirty = ko.observable(false);

		this.showInvalidMessage = ko.pureComputed(
			() => !this.isDirty() && loginInfo().retryCount > 0 
		);

		this.errors = ko.validation.group(this);
	}

	signIn() {
		if (this.errors().length === 0) {
			this.isDirty(false);
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