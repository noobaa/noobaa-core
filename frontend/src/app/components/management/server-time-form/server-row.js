/* Copyright (C) 2018 NooBaa */

import ko from 'knockout';
import { getServerDisplayName, getServerStateIcon } from 'utils/cluster-utils';
import { timeLongFormat } from 'config';
import moment from 'moment';

export default class ServerRowViewModel {
    time = 0;
    timezone = '';
    state = ko.observable();
    serverName = ko.observable();
    address = ko.observable();
    timeSettings = ko.observable();
    ntpServer = ko.observable();
    formattedTime = ko.observable();
    edit = {
        id: ko.observable(),
        onClick: null,
        icon: 'edit-small',
        tooltip: 'Edit Date and Time'
    };


    constructor({ onEdit }) {
        this.edit.onClick = onEdit;

        this.ticker = setInterval(
            () => {
                this.time += 1000;
                const formattedTime = moment.tz(this.time, this.timezone).format(timeLongFormat);
                this.formattedTime(formattedTime);
            },
            1000
        );
    }

    onState(server) {
        const serverName = `${getServerDisplayName(server)} ${server.isMaster ? '(Master)' : ''}`;
        const formattedTime = moment.tz(this.time, this.timezone).format(timeLongFormat);
        const timeSettings = server.ntp ? 'network time (NTP)' : 'manual server time';
        const ntpServer = server.ntp ? server.ntp.server : 'Not Configured';

        this.time = server.time;
        this.timezone = server.timezone;
        this.state(getServerStateIcon(server));
        this.serverName(serverName);
        this.address(server.addresses[0]);
        this.timeSettings(timeSettings);
        this.ntpServer(ntpServer);
        this.formattedTime(formattedTime);
        this.edit.id(server.secret);
    }

    dispose() {
        clearInterval(this.ticker);
    }
}
