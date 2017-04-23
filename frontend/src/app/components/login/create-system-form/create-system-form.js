/* Copyright (C) 2016 NooBaa */

import template from './create-system-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { validateActivation, attemptResolveSystemName, createSystem } from 'actions';
import { activationState, nameResolutionState, serverInfo } from 'model';
import moment from 'moment';
import { deepFreeze } from 'utils/core-utils';
import { calcPasswordStrength } from 'utils/password-utils';

const activationFaliureReasonMapping = deepFreeze({
    ACTIVATION_CODE_IN_USE: 'Activation code is already in use',
    UNKNOWN_ACTIVATION_CODE: 'Activation code does not exists',
    ACTIVATION_CODE_EMAIL_MISMATCH: 'Email does not match activation code'
});

class CreateSystemFormViewModel extends BaseViewModel {
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
                required: { message: 'Please enter your activation code' },
                validation: {
                    async: true,
                    validator: (code, _, callback) => {
                        validateActivation(code);

                        activationState.once(
                            ({ valid, reason }) => callback({
                                isValid: valid || reason === 'ACTIVATION_CODE_EMAIL_MISMATCH',
                                message: reason && activationFaliureReasonMapping[reason]
                            })
                        );
                    }
                }
            });

        this.email = ko.observable()
            .extend({
                required: { message: 'Please enter an email address' },
                email: true,
                validation: {
                    async: true,
                    onlyIf: () => {
                        return this.activationCode.isValid() &&
                            !this.activationCode.isValidating();
                    },
                    validator: (email, _, callback) => {
                        validateActivation(this.activationCode(), email);

                        activationState.once(
                            ({ valid, reason }) => callback({
                                isValid: valid || reason !== 'ACTIVATION_CODE_EMAIL_MISMATCH',
                                message: reason && activationFaliureReasonMapping[reason]
                            })
                        );
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

        this.calcPasswordStrength = calcPasswordStrength;

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
                isDNSName: true,
                validation: {
                    async: true,
                    message: 'Colud not resolve DNS name',
                    onlyIf: () => this.serverDNSName(),
                    validator: (name, _, callback) => {
                        attemptResolveSystemName(name);

                        nameResolutionState.once(
                            ({ valid }) => callback({
                                isValid: valid,
                                message: 'Cloud not resolve dns name'
                            })
                        );
                    }
                }
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
            timezone: serverConfig.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
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
