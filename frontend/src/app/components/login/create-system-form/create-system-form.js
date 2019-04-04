/* Copyright (C) 2016 NooBaa */

import template from './create-system-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { createSystem } from 'action-creators';
import { serverInfo } from 'model';
import moment from 'moment';
import { calcPasswordStrength } from 'utils/password-utils';
import { formatEmailUri } from 'utils/browser-utils';
import { support } from 'config';
import { action$ } from 'state';

class CreateSystemFormViewModel extends BaseViewModel {
    constructor() {
        super();

        this.supportEmailHref = formatEmailUri(support.email, support.createSystemSupportSubject);
        this.wasValidated = ko.observable(false);
        this.creatingSystem = ko.observable(false);

        const serverConfig = ko.pureComputed(() =>
            serverInfo() ? serverInfo().config : {}
        );

        const ownerAccount = ko.pureComputed(() =>
            serverConfig().owner || {}
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

        this.isSystemNameInvalid = ko.pureComputed(() => {
            const { systemName } = this;
            return systemName.isModified() && !systemName.isValid() && !systemName.isValidating();
        });

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

        this.isEmailInvalid = ko.pureComputed(() => {
            const { email } = this;
            return email.isModified() && !email.isValid() && !email.isValidating();
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

        this.errors = ko.validation.group([
            this.systemName,
            this.email,
            this .password
        ]);
    }

    createSystem() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {

            const serverConfig = serverInfo().config;
            const dnsServers = (!serverConfig.using_dhcp && serverConfig.dns_servers) ?
                serverConfig.dns_servers :
                [];

            const timeConfig = {
                timezone: serverConfig.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                ntp_server: serverConfig.ntp_server,
                epoch: !serverConfig.ntp_server ? moment().unix() : undefined
            };

            this.creatingSystem(true);
            action$.next(createSystem(
                this.email(),
                this.password(),
                this.systemName(),
                '',
                dnsServers,
                timeConfig
            ));
        }
    }
}

export default {
    viewModel: CreateSystemFormViewModel,
    template: template
};
