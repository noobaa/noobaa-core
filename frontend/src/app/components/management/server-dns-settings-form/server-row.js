/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { action$ } from 'state';
import { openEditServerDNSSettingsModal } from 'action-creators';

const stateIconMapping = deepFreeze({
    CONNECTED: {
        name: 'healthy',
        css: 'success',
        tooltip: 'Healthy'
    },

    IN_PROGRESS: {
        name: 'in-progress',
        css: 'warning',
        tooltip: 'In Progress'
    },

    DISCONNECTED: {
        name: 'problem',
        css: 'error',
        tooltip: 'Problem'
    }
});

export default class ServerRowViewModel extends BaseViewModel {
    constructor(server) {
        super();

        this.state = ko.pureComputed(
            () => server() ? stateIconMapping[server().status] : ''
        );

        this.serverName = ko.pureComputed(
            () => {
                if (!server()) {
                    return '';
                }

                const { secret, hostname } = server();
                const masterSecret = systemInfo() && systemInfo().cluster.master_secret;
                const suffix = secret === masterSecret ? '(Master)' : '';
                return `${hostname}-${secret} ${suffix}`;

            }
        );

        this.address = ko.pureComputed(
            () => server() ? server().addresses[0] : ''
        );

        const dnsServers = ko.pureComputed(
            () => server() ? server().dns_servers : []
        );

        this.primaryDNS = ko.pureComputed(
            () => dnsServers()[0] || 'not set'
        );

        this.secondaryDNS = ko.pureComputed(
            () => dnsServers()[1] || 'not set'
        );

        this.actions = {
            text: 'Edit',
            click: () => action$.onNext(openEditServerDNSSettingsModal(server().secret))
        };
    }
}
