import template from './create-system-form.html';
import ko from 'knockout';
import { createSystemAccount } from 'actions';

class CreateSystemFormViewModel {
    constructor() {
        this.ownerEmail = ko.observable()
            .extend({ 
                required: { message: 'Please enter an email address' },
                email: true
            });
        
        this.ownerPassword = ko.observable()
            .extend({ 
                required: { message: 'Please enter a password' } 
            });

        this.confirmPassword = ko.observable()
            .extend({ 
                equal: { 
                    params: this.ownerPassword, 
                    message: 'Passwords must match' 
                } 
            });

        this.systemName = ko.observable()
            .extend({ 
                required: { message: 'Please enter a system name' }, 
                maxLength: { 
                    params: 50, 
                    message: 'System name cannot be longer then 50 characters' 
                }
            });

        this.systemDNS = ko.observable();

        this.errors = ko.validation.group({
            ownerEmail: this.ownerEmail,
            ownerPassword: this.ownerPassword,
            confirmPassword: this.confirmPassword,
            systemName: this.systemName
        });            

    }

    createSystem() {
        if (this.errors().length === 0) {
            createSystemAccount(this.systemName(), this.ownerEmail(), this.ownerPassword(), this.systemDNS());
        } else {
            this.errors.showAllMessages();
        }
    }
}

export default {
    viewModel: CreateSystemFormViewModel,
    template: template
}