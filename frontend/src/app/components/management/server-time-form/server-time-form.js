/* Copyright (C) 2016 NooBaa */

import template from './server-time-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import moment from 'moment';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { getServerDisplayName, getServerStateIcon } from 'utils/cluster-utils';
import { timeTickInterval, timeLongFormat } from 'config';
import * as routes from 'routes';
import { requestLocation, openEditServerTimeSettingsModal } from 'action-creators';

const sectionName = 'server-time';
const notSupportedTooltip = 'Editing date & time is not supported in a container environment. Please configure via the host';
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

class ServerRowViewModel {
    table = null;
    time = 0;
    timezone = '';
    state = ko.observable();
    serverName = ko.observable();
    address = ko.observable();
    timeSettings = ko.observable();
    ntpServer = ko.observable();
    formattedTime = ko.observable();
    edit = {
        id: '',
        onClick: this.onEdit.bind(this),
        icon: 'edit-small',
        disabled: ko.observable(),
        tooltip: {
            align: 'end',
            text: ko.observable()
        }
    };

    constructor({ table }) {
        this.table = table;
    }

    onEdit(serveSecret) {
        this.table.onEditServerTime(serveSecret);
    }
}

class ServerTimeFormViewModel extends ConnectableViewModel {
    ticker = 0;
    columns = columns;
    toggleUri = '';
    time = 0;
    timezone = '';
    dataReady = ko.observable();
    isExpanded = ko.observable();
    formattedMasterTime = ko.observable();
    rows = ko.observableArray()
        .ofType(ServerRowViewModel, { table: this });

    constructor(params, inject) {
        super(params, inject);

        this.ticker = setInterval(
            () => this.onTick(),
            timeTickInterval
        );
    }

    selectState(state) {
        const { topology, location, platform } = state;
        return [
            topology && topology.servers,
            location,
            platform && platform.featureFlags.serverClockConfig
        ];
    }

    mapStateToProps(servers, location, allowServerClockConfig) {
        if (!servers) {
            ko.assignToProps(this, {
                dataReady: false
            });
        } else {
            const { system, tab = 'settings', section } = location.params;
            const toggleSection = section === sectionName ? undefined : sectionName;
            const toggleUri = realizeUri(routes.management, { system, tab, section: toggleSection });
            const serversList = Object.values(servers);
            const master = serversList.find(server => server.isMaster);
            const formattedMasterTime = moment.tz(this.time, this.timezone).format(timeLongFormat);
            const now = Date.now();

            ko.assignToProps(this, {
                dataReady: true,
                timezone: master.timezone,
                time: now + master.clockSkew,
                isExpanded: section === sectionName,
                formattedMasterTime,
                toggleUri,
                rows: serversList.map(server => {
                    const { clockSkew, timezone, isMaster, ntp, addresses } = server;
                    const time = now + clockSkew;
                    const address = addresses[0].ip;
                    const state = getServerStateIcon(server);
                    const serverName = `${getServerDisplayName(server)} ${isMaster ? '(Master)' : ''}`;
                    const formattedTime = moment.tz(time, timezone).format(timeLongFormat);
                    const timeSettings = ntp ? 'network time (NTP)' : 'manual server time';
                    const ntpServer = ntp ? ntp.server : 'Not Configured';

                    return {
                        time,
                        timezone,
                        state,
                        serverName,
                        address,
                        timeSettings,
                        ntpServer,
                        formattedTime,
                        edit: {
                            id: server.secret,
                            disabled: !allowServerClockConfig,
                            tooltip: {
                                text:allowServerClockConfig ? 'Edit Date and Time' : notSupportedTooltip
                            }
                        }
                    };
                })
            });
        }
    }

    onTick() {
        if (!this.dataReady()) {
            return;
        }

        ko.assignToProps(this, {
            time: this.time + timeTickInterval,
            formattedMasterTime: moment.tz(this.time + timeTickInterval, this.timezone).format(timeLongFormat),
            rows: this.rows().map(row => ({
                time: row.time + timeTickInterval,
                formattedTime: moment.tz(row.time + timeTickInterval, row.timezone).format(timeLongFormat)
            }))
        });
    }

    onEditServerTime(secret) {
        this.dispatch(openEditServerTimeSettingsModal(secret));
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
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
