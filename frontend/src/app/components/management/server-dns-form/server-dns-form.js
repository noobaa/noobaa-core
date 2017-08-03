/* Copyright (C) 2016 NooBaa */

import template from './server-dns-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo, nameResolutionState } from 'model';
import { attemptResolveSystemName } from 'actions';
import { inputThrottle } from 'config';
import { action$ } from 'state';
import { openUpdateSystemNameModal } from 'action-creators';

const addressOptions = [
    { label: 'Use Server IP', value: 'IP' },
    { label: 'Use DNS Name (recommended)', value: 'DNS' }
];

class ServerDNSFormViewModel extends BaseViewModel {
    constructor({ isCollapsed }) {
        super();

        this.isCollapsed = isCollapsed;

        this.expanded = ko.observable(false);
        this.addressOptions = addressOptions;

        this.addressType = ko.observableWithDefault(
            () => systemInfo() && (!systemInfo().dns_name ? 'IP' : 'DNS')
        );

        this.usingIP = ko.pureComputed(
            () => this.addressType() === 'IP'
        );
        this.usingDNS = ko.pureComputed(
            () => this.addressType() === 'DNS'
        );

        this.ipAddress = ko.pureComputed(
            ()=> systemInfo() && systemInfo().ip_address
        );

        this.dnsName = ko.observableWithDefault(
            () => systemInfo() && systemInfo().dns_name
        )
            .extend({
                rateLimit: {
                    timeout: inputThrottle,
                    method: 'notifyWhenChangesStop'
                }
            })
            .extend({
                required: {
                    onlyIf: () => this.usingDNS(),
                    message: 'Please enter a DNS Name'
                },
                isDNSName: true,
                validation: {
                    async: true,
                    onlyIf: () => this.usingDNS(),
                    validator: (name, _, callback) => {
                        attemptResolveSystemName(name);

                        nameResolutionState.once(
                            ({ valid }) => callback({
                                isValid: valid,
                                message: 'Could not resolve dns name'
                            })
                        );
                    }
                }
            });

        this.baseAddress = ko.pureComputed(
            () => this.usingIP() ? this.ipAddress() : this.dnsName()
        );

        this.serverAddress = ko.pureComputed(
            () => systemInfo()
                && (!systemInfo().dns_name ? this.ipAddress() : systemInfo().dns_name)
        );

        this.errors = ko.validation.group([
            this.dnsName
        ]);

    }

    update() {
        if (this.errors.validatingCount() > 0 || this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            action$.onNext(openUpdateSystemNameModal(this.baseAddress()));
        }
    }
}

export default {
    viewModel: ServerDNSFormViewModel,
    template: template
};
