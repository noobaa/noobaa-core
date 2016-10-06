import template from './create-system-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { validateActivationCode, validateActivationEmail, createSystem } from 'actions';
import { activationCodeValid, activationEmailValid, serverInfo } from 'model';
import moment from 'moment';
import { waitFor } from 'utils';
import { calcPasswordStrenght } from 'utils';

class CreateSystemFormViewModel extends Disposable {
    constructor() {
        super();

        // Wizard configuration:
        // ---------------------
        this.steps = ['account details', 'system config'];
        this.step = ko.observable(0);

        let serverConfig = ko.pureComputed(
            () => serverInfo() ? serverInfo().config : {}
        );

        this.isUnableToActivateModalVisible = ko.pureComputed(
            () => serverConfig().phone_home_connectivity_status !== 'CONNECTED'
        );

        // First step fields:
        // -------------------

        this.activationCode = ko.observable()
            .extend({
                required: {
                    message: 'Please enter your activation code'
                },
                validation: {
                    message: 'Invalid code - register at www.noobaa.com',
                    async: true,
                    validator: (value, __, callback) => {
                        activationCodeValid.once(
                            ({ isValid }) => {
                                waitFor(500).then(
                                    () => callback(isValid)
                                );
                            }
                        );
                        validateActivationCode(value);
                    }
                }
            });

        // the email validation depends on activationCode,
        // se we re-trigger the email validation when the code changes
        this.activationCode.subscribe(
            () => ko.validation.validateObservable(this.email)
        );

        this.email = ko.observable()
            .extend({
                required: { message: 'Please enter an email address' },
                email: true,
                validation: {
                    message: 'Email does not match the activation code',
                    async: true,
                    validator: (value, __, callback) => {
                        activationEmailValid.once(
                            ({ isValid }) => {
                                waitFor(500).then(
                                    () => callback(isValid)
                                );
                            }
                        );
                        validateActivationEmail(this.activationCode(), value);
                    }
                }
            });

        this.password = ko.observable()
            .extend({
                required: { message: 'Please enter a password' },
                minLength: 5,
                includesUppercase: true,
                includesLowercase: true,
                includesDigit: true
            });

        this.isPasswordValid = ko.pureComputed(
            () => this.password() && this.password.isValid()
        ).extend({
            equal: {
                params: true,
                message: 'Please enter a valid password'
            },
            isModified: this.password.isModified
        });

        this.passwordValidations = ko.pureComputed(
            () => ko.validation.fullValidationState(this.password)()
                .filter(
                    validator => validator.rule !== 'required'
                )
                .map(
                    validator => ({
                        message: validator.message,
                        isValid: this.password() && validator.isValid
                    })
                )
        );

        this.calcPasswordStrenght = calcPasswordStrenght;

        this.name = ko.pureComputed(
            () => this.email() && this.email().split('@')[0]
        );

        // Second step fields:
        // -------------------

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

        // Wizard controls:
        // ----------------

        this.isPrevVisible = ko.pureComputed(
            () => this.step() > 0
        );

        this.isNextVisible = ko.pureComputed(
            () => this.step() < this.steps.length - 1
        );

        this.isCreateSystemVisible = ko.pureComputed(
            () => this.step() === this.steps.length - 1
        );

        // Error groups:
        // -------------

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
                this.serverDNSName
            ])
        ];
    }

    validateStep(step) {
        let errors = this.errorsByStep[step];
        let validating = errors
            .filter(
                obj => obj.isValidating()
            )
            .length;

        if (validating || errors().length > 0) {
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
        let serverConfig = serverInfo().config;

        let dnsServers = [];
        if (!serverConfig.using_dhcp && serverConfig.dns_servers) {
            dnsServers = serverConfig.dns_servers;
        }

        let timeConfig = {
            timezone: serverConfig.timezone || Intl.DateTimeFormat().resolved.timeZone,
            ntp_server: serverConfig.ntp_server,
            epoch: !serverConfig.ntp_server ? moment().unix() : undefined
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
