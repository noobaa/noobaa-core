/* Copyright (C) 2016 NooBaa */

import template from './server-time-form.html';
import BaseViewModel from 'components/base-view-model';
import ServerRow from './server-row';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { timeLongFormat } from 'config';

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
        name: 'time',
        label: 'server time'
    },
    {
        name: 'actions',
        type: 'button',
        label: ''
    }
]);

class ServerTimeFormViewModel extends BaseViewModel {
    constructor({ isCollapsed }) {
        super();

        this.columns = columns;
        this.isCollapsed = isCollapsed;


        const cluster = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster
        );

        this.servers = ko.pureComputed(
            () => cluster() ? cluster().shards[0].servers : []
        );

        const master = ko.pureComputed(
            () => this.servers().find(
                server => server.secret === (cluster() || {}).master_secret
            )
        );

        const masterTimezone = ko.pureComputed(
            () => master() && master().timezone
        );

        this.masterTime = ko.observableWithDefault(
            () => master() && master().time_epoch * 1000
        );

        this.formattedMasterTime = this.masterTime.extend({
            formatTime: {
                format: timeLongFormat,
                timezone: masterTimezone
            }
        });

        this.addToDisposeList(
            setInterval(
                () => this.masterTime() && this.masterTime(this.masterTime() + 1000),
                1000
            ),
            clearInterval
        );
    }

    createRow(server) {
        return new ServerRow(server);
    }
}

export default {
    viewModel: ServerTimeFormViewModel,
    template: template
};
