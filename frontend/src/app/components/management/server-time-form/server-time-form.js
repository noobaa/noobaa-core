/* Copyright (C) 2016 NooBaa */

import template from './server-time-form.html';
import Observer from 'observer';
import ServerRow from './server-row';
import ko from 'knockout';
import moment from 'moment';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getMany } from 'rx-extensions';
import { timeLongFormat } from 'config';
import { action$, state$ } from 'state';
import * as routes from 'routes';
import { requestLocation, openEditServerTimeSettingsModal } from 'action-creators';

const sectionName = 'server-time';
const columns = deepFreeze([
    {
        name: 'state',
        label: '',
        type: 'icon'
    },
    {
        name: 'serverName'
    },
    {
        name: 'address',
        label: 'IP Address'
    },
    {
        name: 'ntpServer',
        label: 'NTP Server'
    },
    {
        name: 'formattedTime',
        label: 'server time'
    },
    {
        name: 'edit',
        label: '',
        type: 'iconButton'
    }
]);

class ServerTimeFormViewModel extends Observer {
    columns = columns;
    toggleUri = '';
    time = 0;
    timezone = '';
    isExpanded = ko.observable();
    formattedMasterTime = ko.observable();
    serversLoaded = ko.observable();
    rows = ko.observableArray();
    rowParams = {
        onEdit: this.onEditServerTime.bind(this)
    };

    constructor() {
        super();

        this.ticker = setInterval(
            () => {
                if (!this.serversLoaded()) return;
                this.time += 1000;
                const formattedMasterTime = moment.tz(this.time, this.timezone).format(timeLongFormat);
                this.formattedMasterTime(formattedMasterTime);
            },
            1000
        );

        this.observe(
            state$.pipe(
                getMany(
                    ['topology', 'servers'],
                    'location'
                )
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
        const formattedMasterTime = moment.tz(this.time, this.timezone).format(timeLongFormat);
        const rows = serversList
            .map((server, i) => {
                const row = this.rows.get(i) || new ServerRow(this.rowParams);
                row.onState(server);
                return row;
            });

        this.timezone = master.timezone;
        this.time = master.time;
        this.isExpanded(section === sectionName);
        this.formattedMasterTime(formattedMasterTime);
        this.rows(rows);
        this.toggleUri = toggleUri;
        this.serversLoaded(true);
    }

    onEditServerTime(secret) {
        action$.next(openEditServerTimeSettingsModal(secret));
    }

    onToggleSection() {
        action$.next(requestLocation(this.toggleUri));
    }

    dispose(){
        clearInterval(this.ticker);
        super.dispose();
    }
}

export default {
    viewModel: ServerTimeFormViewModel,
    template: template
};
