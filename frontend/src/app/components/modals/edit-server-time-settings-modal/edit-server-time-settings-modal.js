/* Copyright (C) 2016 NooBaa */

import template from './edit-server-time-settings-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import moment from 'moment-timezone';
import { sumBy } from 'utils/core-utils';
import { inputThrottle } from 'config';
import { systemInfo, serverTime, ntpResolutionState } from 'model';
import { loadServerTime, updateServerClock, updateServerNTPSettings, attemptResolveNTPServer } from 'actions';

class EditServerTimeSettingsModalViewModel extends BaseViewModel {
    constructor({ serverSecret, onClose }) {
        super();

        this.onClose = onClose;
        this.serverSecret = ko.unwrap(serverSecret);

        const server = ko.pureComputed(
            () => systemInfo() && systemInfo().cluster.shards[0].servers.find(
                server => server.secret === this.serverSecret
            )
        );

        this.hostname = ko.pureComputed(
            () => server() && server().hostname
        );

        const inClusterEnv = ko.pureComputed(
            () => {
                if (!systemInfo()) return;

                const serverCount = sumBy(
                    systemInfo().cluster.shards
                        .map(shard => shard.servers.length)
                );

                return serverCount > 1;
            }
        );

        const manualTimeTooltip = ko.pureComputed(
            () => inClusterEnv() ?
                'Mannual time cannot be used in a cluster environment' :
                ''
        );

        this.configTypes = [
            {
                label: 'Manual Time',
                value: 'MANUAL',
                disabled: inClusterEnv,
                tooltip: manualTimeTooltip
            },
            {
                label: 'Network Time (NTP)',
                value: 'NTP'
            }
        ];

        this.selectedConfigType = ko.observableWithDefault(
            () => server() && server().ntp_server ? 'NTP' : 'MANUAL'
        );

        this.usingManualTime = ko.pureComputed(
            () => this.selectedConfigType() === 'MANUAL'
        );

        this.usingNTP = ko.pureComputed(
            () => this.selectedConfigType() === 'NTP'
        );

        this.timezone = ko.observableWithDefault(
            () => server() && server().timezone
        );

        this.time = ko.observableWithDefault(
            () => serverTime() && serverTime().server ===  ko.unwrap(serverSecret) ?
                serverTime().time * 1000 :
                0
        );

        this.addToDisposeList(
            setInterval(
                () => this.time() && this.time(this.time() + 1000),
                1000
            ),
            clearInterval
        );

        this.ntpServer = ko.observableWithDefault(
            () => server() && server().ntp_server
        )
            .extend({
                isIPOrDNSName: true,
                required: { message: 'Please enter an NTP server address' }
            })
            .extend({
                rateLimit: {
                    timeout: inputThrottle,
                    method: 'notifyWhenChangesStop'
                }
            })
            .extend({
                required: {
                    onlyIf: () => this.usingNTP(),
                    message: 'Please enter a NTP server Name / IP'
                },
                isDNSName: true,
                validation: {
                    async: true,
                    onlyIf: () => this.usingNTP(),
                    validator: (name, _, callback) => {
                        attemptResolveNTPServer(name, this.serverSecret);

                        ntpResolutionState.once(
                            ({ valid, serverSecret }) => callback({
                                isValid: valid && serverSecret === this.serverSecret,
                                message: 'Could not resolve NTP server'
                            })
                        );
                    }
                }
            });


        this.ntpErrors = ko.validation.group([
            this.ntpServer
        ]);

        this.isValid = ko.pureComputed(
            () => this.usingManualTime() || (this.ntpErrors().length === 0 && !this.ntpServer.isValidating)
        );

        loadServerTime(this.serverSecret);
    }

    save() {
        this.usingNTP() ? this.setNTPTime() : this.setManualTime();
    }

    setManualTime() {
        let epoch = moment.tz(this.time(), this.timezone()).unix();
        updateServerClock(this.serverSecret, this.hostname(), this.timezone(), epoch);
        this.onClose();
    }

    setNTPTime() {
        if (this.ntpErrors().length > 0 || this.ntpErrors.validatingCount() > 0) {
            this.ntpErrors.showAllMessages();

        } else {
            updateServerNTPSettings(this.serverSecret, this.hostname(), this.timezone(), this.ntpServer());
            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: EditServerTimeSettingsModalViewModel,
    template: template
};
