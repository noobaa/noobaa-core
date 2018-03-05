/* Copyright (C) 2018 NooBaa */

import template from './server-dns-settings-form.html';
import Observer from 'observer';
import ServerRow from './server-row';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { action$, state$ } from 'state';
import * as routes from 'routes';
import { requestLocation, openEditServerDNSSettingsModal } from 'action-creators';

const sectionName = 'dns-settings';
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

class ServerDnsSettingsFormViewModel extends Observer {
    columns = columns;
    isExpanded = ko.observable();
    serversLoaded = ko.observable();
    masterPrimaryDNS = ko.observable();
    masterSecondaryDNS = ko.observable();
    rows = ko.observableArray();
    rowParams = {
        onEdit: this.onEditServerDNS.bind(this)
    };

    constructor() {
        super();

        this.observe(
            state$.getMany(
                ['topology', 'servers'],
                'location'
            ),
            this.onState
        );
    }

    onState([servers, location]) {
        if (!servers) {
            this.serversLoaded(false);
            return;
        }

        const { system, tab = 'settings', section } = location.params;
        const toggleSection = section === sectionName ? undefined : sectionName;
        const toggleUri = realizeUri(
            routes.management,
            { system, tab, section: toggleSection }
        );
        const serversList = Object.values(servers);
        const master = serversList.find(server => server.isMaster);
        const [
            masterPrimaryDNS = 'Not Set' ,
            masterSecondaryDNS = 'Not Set'
        ] = master.dns.servers.list;

        const rows = serversList
            .map((server, i) => {
                const row = this.rows.get(i) || new ServerRow(this.rowParams);
                row.onState(server);
                return row;
            });

        this.masterPrimaryDNS(masterPrimaryDNS);
        this.masterSecondaryDNS(masterSecondaryDNS);
        this.isExpanded(section === sectionName);
        this.rows(rows);
        this.toggleUri = toggleUri;
        this.serversLoaded(true);
    }

    onEditServerDNS(secret) {
        action$.onNext(openEditServerDNSSettingsModal(secret));
    }

    onToggleSection() {
        action$.onNext(requestLocation(this.toggleUri));
    }
}

export default {
    viewModel: ServerDnsSettingsFormViewModel,
    template: template
};
