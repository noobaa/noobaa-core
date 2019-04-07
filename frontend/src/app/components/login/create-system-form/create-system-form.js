/* Copyright (C) 2016 NooBaa */

import template from './create-system-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { attemptResolveSystemName } from 'actions';
import { createSystem } from 'action-creators';
import { nameResolutionState, serverInfo } from 'model';
import moment from 'moment';
import { calcPasswordStrength } from 'utils/password-utils';
import { action$ } from 'state';

class CreateSystemFormViewModel extends BaseViewModel {
    constructor() {
        super();

        // Wizard configuration:
        // ---------------------
        this.steps = ['account details', 'system config'];
        this.step = ko.observable(0);
        this.wasValidated = ko.observable(false);
        this.creatingSystem = ko.observable(false);

        const serverConfig = ko.pureComputed(
            () => serverInfo() ? serverInfo().config : {}
        );

        const ownerAccount = ko.pureComputed(
            () => serverConfig().owner || {}
        );

        // First step fields:
        // -------------------
        this.isEmailDisabled = ko.pureComputed(() =>
            Boolean(ownerAccount().email)
        );
        this.isEmailSpinnerVisible = ko.pureComputed(() =>
            !ownerAccount().email && this.email.isValidating()
        );
        this.email = ko.observableWithDefault(() =>
            ownerAccount().email
        )
            .extend({
                required: { message: 'Please enter an email address' },
                email: true
            });

        this.password = ko.observable()
            .extend({
                validation: {
                    validator: pass => pass && (pass.length >= 5),
                    message: 'Use at least 5 characters'
                },
                includesUppercase: true,
                includesLowercase: true,
                includesDigit: true
            });

        this.isPasswordInvalid = ko.pureComputed(() => {
            const { password } = this;
            return password.isModified() && !password.isValid() && !password.isValidating();
        });

        this.calcPasswordStrength = calcPasswordStrength;

        this.name = ko.pureComputed(() =>
            this.email() && this.email().split('@')[0]
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

        this.shakeCreateBtn = ko.pureComputed(
            () => this.errorsByStep.some(g => g().length > 0)
        );
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
            this.wasValidated(true);
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
        this.step(this.step() - 1);
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
            action$.next(createSystem(
                this.email(),
                this.password(),
                this.systemName(),
                this.serverDNSName(),
                dnsServers,
                timeConfig
            ));
            this.creatingSystem(true);
        }
    }
}

export default {
    viewModel: CreateSystemFormViewModel,
    template: template
};
