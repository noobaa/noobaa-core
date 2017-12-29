/* Copyright (C) 2016 NooBaa */

import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils/core-utils';
import { timeLongFormat } from 'config';
import { action$ } from 'state';
import { openEditServerTimeSettingsModal } from 'action-creators';

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

        this.timeSettings = ko.pureComputed(
            () => server() && (
                server().ntp_server ? 'network time (NTP)' : 'maunal server time'
            )
        );

        this.ntpServer = ko.pureComputed(
            () => (server() && server().ntp_server) || 'Not Configured'
        );

        const timezone = ko.pureComputed(
            () => server() && server().timezone
        );

        const _time = ko.pureComputed(
            () => server() && server().time_epoch * 1000
        );

        const time = ko.observableWithDefault(
            () => _time()
        );

        this.time = time.extend({
            formatTime: {
                format: timeLongFormat,
                timezone: timezone
            }
        });

        let timestamp = _time();

        this.addToDisposeList(
            setInterval(
                () => {
                    if(_time() === timestamp) {
                        time() && time(time() + 1000);
                    } else {
                        timestamp = _time();
                        time() && time(_time());
                    }
                },
                1000
            ),
            clearInterval
        );

        this.actions = {
            text: 'Edit',
            click: () => action$.onNext(openEditServerTimeSettingsModal(server().secret))
        };
    }
}
