/* Copyright (C) 2016 NooBaa */

import template from './unable-to-activate-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { support } from 'config';
import { serverInfo } from 'model';
import { action$ } from 'state';
import { closeModal } from 'action-creators';

class UnableToActivateModalViewModel extends BaseViewModel {
    constructor({ reason }) {
        super();

        this.reason = reason;

        const config = ko.pureComputed(
            () => serverInfo().config
        );

        const ipAssigment = ko.pureComputed(
            () => config().using_dhcp ? 'Dynamic (DHCP)' : 'Static'
        );

        const serverAddress = ko.pureComputed(
            () => serverInfo().address
        );

        const dnsServers = ko.pureComputed(
            () => config().dns_servers || []
        );

        const primaryDNSServer = ko.pureComputed(
            () => dnsServers()[0] || 'Not set'
        );

        const secondaryDNSServer = ko.pureComputed(
            () => dnsServers()[1] || 'Not set'
        );

        const proxy = ko.pureComputed(
            () => {
                const { used_proxy: proxy } = config();
                return proxy ?
                    `http://${proxy.address}:${proxy.port}` :
                    'Not set';
            }
        );

        this.networkDetails = [
            {
                label: 'IP Assignment',
                value: ipAssigment
            },
            {
                label: 'Server Address',
                value: serverAddress
            },
            {
                label: 'Primary DNS Server',
                value: primaryDNSServer
            },
            {
                label: 'Secondary DNS Server',
                value: secondaryDNSServer
            },
            {
                label: 'Proxy',
                value: proxy
            }
        ];

        this.supportEmailUrl = `mailto:${support.email}`;
    }

    onClose() {
        action$.next(closeModal());
    }
}

export default {
    viewModel: UnableToActivateModalViewModel,
    template: template
};
