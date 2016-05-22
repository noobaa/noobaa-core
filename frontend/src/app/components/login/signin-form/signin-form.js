import template from './signin-form.html';
import ko from 'knockout';
import { uiState, loginInfo } from 'model';
import { signIn } from 'actions';

class SignInFormViewModel {
    constructor() {
        this.email = ko.observable()
            .extend({
                required: { message: 'Please enter an email address' },
                email: { message: 'Please enter a valid email address' }
            });

        this.password = ko.observable()
            .extend({
                required: { message: 'Please enter a password' }
            });

        let retryCount = ko.pureComputed(
            () => loginInfo().retryCount
        );

        this.isDirty = ko.observable(false);

        this.showInvalidMessage = ko.pureComputed(
            () => !this.isDirty() && retryCount() > 0
        );

        this.shake = ko.observable(false);

        this.errors = ko.validation.group(this);

        this.countSub = retryCount.subscribe(
            () => this.shake(true)
        );
    }

    signIn() {
        if (this.errors().length === 0) {
            this.isDirty(false);
            signIn(this.email(), this.password(), uiState().returnUrl);

        } else {
            this.shake(true);
            this.errors.showAllMessages();
        }
    }

    dispose() {
        this.countSub.dispose();
    }
}

export default {
    viewModel: SignInFormViewModel,
    template: template
}
