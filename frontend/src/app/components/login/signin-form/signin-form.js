import template from './signin-form.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import { uiState, loginInfo } from 'model';
import { signIn } from 'actions';

class SignInFormViewModel extends BaseViewModel {
    constructor() {
        super();

        this.email = ko.observable()
            .extend({
                required: { message: 'Please enter an email address' },
                email: { message: 'Please enter a valid email address' }
            });

        this.password = ko.observable()
            .extend({
                required: { message: 'Please enter a password' }
            });

        this.keepSessionAlive = ko.observable(false);

        let retryCount = ko.pureComputed(
            () => loginInfo().retryCount
        );

        this.isDirty = ko.observable(false);

        this.showInvalidMessage = ko.pureComputed(
            () => !this.isDirty() && retryCount() > 0
        );

        this.errors = ko.validation.group([
            this.email,
            this.password
        ]);
    }

    signIn() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            this.isDirty(false);
            signIn(
                this.email(),
                this.password(),
                this.keepSessionAlive(),
                uiState().returnUrl);
        }
    }
}

export default {
    viewModel: SignInFormViewModel,
    template: template
};
