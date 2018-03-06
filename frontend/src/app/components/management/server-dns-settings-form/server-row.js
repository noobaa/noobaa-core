/* Copyright (C) 2018 NooBaa */

import ko from 'knockout';
import { getServerDisplayName, getServerStateIcon } from 'utils/cluster-utils';

export default class ServerRowViewModel {
    state = ko.observable();
    serverName = ko.observable();
    address = ko.observable();
    dnsServers = ko.observable();
    primaryDNS = ko.observable();
    secondaryDNS = ko.observable();

    edit = {
        id: ko.observable(),
        onClick: null,
        icon: 'edit',
        tooltip: 'Edit DNS'
    };

    constructor({ onEdit }) {
        this.edit.onClick = onEdit;
    }

    onState(server) {
        const serverName = `${getServerDisplayName(server)} ${server.isMaster ? '(Master)' : ''}`;
        const primaryDNS = server.dns.servers.list[0] || 'not set';
        const secondaryDNS = server.dns.servers.list[1] || 'not set';

        this.edit.id(server.secret);
        this.state(getServerStateIcon(server));
        this.serverName(serverName);
        this.address(server.addresses[0]);
        this.primaryDNS(primaryDNS);
        this.secondaryDNS(secondaryDNS);
    }
}
