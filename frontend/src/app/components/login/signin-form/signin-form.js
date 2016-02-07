import template from './signin-form.html';
import ko from 'knockout';
import { uiState, loginInfo } from 'model';
import { signIn } from 'actions';

class SignInFormViewModel {
    constructor() {
        this.email = ko.observable()
            .extend({ 
                required: { message: 'Please enter an email address' },
                email: { message: 'Please enter a proper email address' }
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

        let temp = this.temp = ko.observable(0);
        this.shake = ko.pureComputed({
            read: () => {
                console.log(retryCount(), temp());
                return retryCount() > temp()
            },
            write: val => val === false && temp(retryCount())
        });        

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