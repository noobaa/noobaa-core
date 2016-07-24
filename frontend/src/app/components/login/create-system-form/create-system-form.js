import template from './create-system-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { createSystem } from 'actions';

class CreateSystemFormViewModel extends Disposable {
    constructor() {
        super();

        this.steps = ['account details', 'system config'];
        this.step = ko.observable(0);

        this.activationCode = ko.observable()
            .extend({
                required: { message: 'Please enter your activation code' }
            });

        this.email = ko.observable()
            .extend({
                required: { message: 'Please enter an email address' },
                email: true
            });

        this.password = ko.observable()
            .extend({
                required: { message: 'Please enter a password' }
            });

        this.confirmPassword = ko.observable()
            .extend({
                equal: {
                    params: this.password,
                    message: 'Passwords must match'
                }
            });

        this.name = ko.pureComputed(
            () => this.email() && this.email().split('@')[0]
        );

        this.systemName = ko.observable()
            .extend({
                required: { message: 'Please enter a system name' },
                hasNoLeadingOrTrailingSpaces: true,
                maxLength: {
                    params: 50,
                    message: 'System name cannot be longer then 50 characters'
                }
            });

        this.serverDNSName = ko.observable()
            .extend({
                isDNSName: true
            });

        this.primaryDNSServerIP = ko.observable()
            .extend({
                isIP: true
            });

        this.isPrevVisible = ko.pureComputed(
            () => this.step() > 0
        );

        this.isNextVisible = ko.pureComputed(
            () => this.step() < this.steps.length - 1
        );

        this.isCreateSystemVisible = ko.pureComputed(
            () => this.step() === this.steps.length - 1
        );

        this.errorsByStep = [
            // Account details validations
            ko.validation.group([
                this.activationCode,
                this.email,
                this.password,
                this.confirmPassword
            ]),

            // System config validations
            ko.validation.group([
                this.systemName,
                this.serverDNSName,
                this.primaryDNSServerIP
            ])
        ];
    }

    validateStep(step) {
        let errors = this.errorsByStep[step];
        if (errors().length > 0) {
            errors.showAllMessages();
            return false;
        } else {
            return true;
        }
    }

    next() {
        if (this.validateStep(this.step())) {
            this.step(this.step() + 1);
        }
    }

    prev() {
        this.step(this.step() -1);
    }

    createSystem() {
        let dnsServers = this.primaryDNSServerIP() ?
            [ this.primaryDNSServerIP() ] :
            undefined;

        let timeConfig = {
            timezone: Intl.DateTimeFormat().resolved.timeZone,
            epoch: Date.now()
        };

        if (this.validateStep(this.step())) {
            createSystem(
                this.activationCode(),
                this.email(),
                this.password(),
                this.systemName(),
                this.serverDNSName(),
                dnsServers,
                timeConfig
            );
        }
    }
}

export default {
    viewModel: CreateSystemFormViewModel,
    template: template
};
