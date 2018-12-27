/* Copyright (C) 2016 NooBaa */

import template from './server-dns-settings-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getServerDisplayName, getServerStateIcon } from 'utils/cluster-utils';
import * as routes from 'routes';
import { requestLocation, openEditServerDNSSettingsModal } from 'action-creators';

const sectionName = 'dns-settings';
const disabledEditTooltip = 'Editing DNS Servers and Search Domains is not supported in a container environment. Please configure via the host.';
const columns = deepFreeze([
    {
        name: 'state',
        type: 'icon'
    },
    {
        name: 'serverName'
    },
    {
        name: 'address',
        label:'IP Address'
    },
    {
        name: 'primaryDNS'
    },
    {
        name: 'secondaryDNS'
    },
    {
        name: 'edit',
        label: '',
        type: 'iconButton'
    }
]);

class ServerRowViewModel {
    table = null;
    state = ko.observable();
    serverName = ko.observable();
    address = ko.observable();
    dnsServers = ko.observable();
    primaryDNS = ko.observable();
    secondaryDNS = ko.observable();
    edit = {
        id: '',
        icon: 'edit-small',
        disabled: ko.observable(),
        onClick: this.onEdit.bind(this),
        tooltip: {
            align: 'end',
            text: ko.observable()
        }
    };

    constructor({ table }) {
        this.table = table;
    }

    onEdit(serverSecret) {
        this.table.onEditServerDNS(serverSecret);
    }
}

class ServerDnsSettingsFormViewModel extends ConnectableViewModel {
    columns = columns;
    isExpanded = ko.observable();
    toggleUri = '';
    dataReady = ko.observable();
    masterPrimaryDNS = {
        text: ko.observable(),
        css: ko.observable()
    };
    masterSecondaryDNS = {
        text: ko.observable(),
        css: ko.observable()
    };
    rows = ko.observableArray()
        .ofType(ServerRowViewModel, { table: this });


    selectState(state) {
        const { topology, location, platform } = state;

        return [
            topology && topology.servers,
            location,
            platform && platform.featureFlags.dnsServersChange
        ];
    }

    mapStateToProps(servers, location, allowDnsServerChange) {
        if (!servers) {
            ko.assignToProps(this,{
                dataReady: false
            });

        } else {
            const { system, tab = 'settings', section } = location.params;
            const toggleSection = section === sectionName ? undefined : sectionName;
            const toggleUri = realizeUri(
                routes.management,
                { system, tab, section: toggleSection }
            );
            const serversList = Object.values(servers);
            const master = serversList.find(server => server.isMaster);
            const [masterPrimaryDNS, masterSecondaryDNS] = master.dns.servers.list;

            ko.assignToProps(this, {
                dataReady: true,
                masterPrimaryDNS: {
                    text: masterPrimaryDNS || 'Not set',
                    css: masterPrimaryDNS ? 'tech-text' : ''
                },
                masterSecondaryDNS: {
                    text: masterSecondaryDNS || 'Not set',
                    css: masterSecondaryDNS ? 'tech-text' : ''
                },
                isExpanded: section === sectionName,
                toggleUri,
                rows: serversList.map(server => {
                    const { isMaster, secret, addresses, dns } = server;
                    const state = getServerStateIcon(server);
                    const address = addresses[0].ip;
                    const serverName = `${getServerDisplayName(server)} ${isMaster ? '(Master)' : ''}`;
                    const [
                        primaryDNS = 'not set',
                        secondaryDNS = 'not set'
                    ] = dns.servers.list;

                    return {
                        state,
                        serverName,
                        address,
                        primaryDNS,
                        secondaryDNS,
                        edit: {
                            id: secret,
                            disabled: !allowDnsServerChange,
                            tooltip: {
                                text: allowDnsServerChange ? 'Edit DNS' : disabledEditTooltip
                            }
                        }
                    };
                })
            });
        }
    }

    onEditServerDNS(secret) {
        this.dispatch(openEditServerDNSSettingsModal(secret));
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }
}

export default {
    viewModel: ServerDnsSettingsFormViewModel,
    template: template
};
