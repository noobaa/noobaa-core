import template from './create-system-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { createSystemAccount } from 'actions';

const timeConfigTypes =  Object.freeze([
    { label: 'Manual Time', value: 'MANUAL' },
    { label: 'Network Time (NTP)', value: 'NTP' }
]);

class CreateSystemFormViewModel extends Disposable {
    constructor() {
        super();

        this.steps = [
            'account details',
            'system config',
            'date and time'
        ];

        this.step = ko.observable(0);

        this.activationCode = ko.observable();

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

        this.timeConfigTypes = timeConfigTypes;
        this.selectedTimeConfigType = ko.observable(timeConfigTypes[0].value);

        this.usingNTP = ko.pureComputed(
            () => this.selectedTimeConfigType() === 'NTP'
        );

        this.timezone = ko.observable(
            Intl.DateTimeFormat().resolved.timeZone
        );

        this.time = ko.observable(Date.now());

        this.ntpServer = ko.observable()
            .extend({
                required: {
                    onlyIf: this.usingNTP,
                    message: 'Please enter an NTP server address'
                },
                isIPOrDNSName: {
                    onlyIf: this.usingNTP,
                    message: 'Please enter a valid NTP server address'
                }
            });

        this.isPrevVisible = ko.pureComputed(
            () => this.step() > 0
        );

        this.isNextVisible = ko.pureComputed(
            () => this.step() < this.steps.length - 1
        );

        this.isCreateSystemVisible = ko.pureComputed(
            () => this.step() === this.steps.length - 1,
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
            ]),

            // Date and time validations
            ko.validation.group([
                this.timezone,
                this.time,
                this.ntpServer
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
        if (this.validateStep(this.step())) {
            createSystemAccount(
                this.systemName(),
                this.email(),
                this.password(),
                this.serverDNSName()
            );
        }
    }
}

export default {
    viewModel: CreateSystemFormViewModel,
    template: template
};
