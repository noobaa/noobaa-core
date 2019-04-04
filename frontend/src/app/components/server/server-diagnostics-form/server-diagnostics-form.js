/* Copyright (C) 2016 NooBaa */

import template from './server-diagnostics-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo, collectDiagnosticsState } from 'model';
import { downloadServerDiagnosticPack, setServerDebugLevel } from 'actions';
import { formatTimeLeftForDebugMode } from 'utils/diagnostic-utils';
import { timeTickInterval } from 'config';

class ServerDiagnosticsFormViewModel extends BaseViewModel {
    constructor({ serverSecret }) {
        super();

        const servers = ko.pureComputed(
            () => systemInfo() ? systemInfo().cluster.shards[0].servers : []
        );

        this.server = ko.pureComputed(
            () => servers().find(
                ({ secret }) => secret === ko.unwrap(serverSecret)
            )
        );

        this.isConnected = ko.pureComputed(
            () => this.server() && this.server().status === 'CONNECTED'
        );

        this.debugMode = ko.pureComputed(
            () => Boolean(this.server() && this.server().debug.level)
        );

        const isTimeLeftDisabled = ko.pureComputed(
            () => !this.debugMode()
        );

        const serverDebugTimeLeft = ko.pureComputed(
            () => this.server() && this.server().debug.time_left
        );

        this.debugTimeLeft = ko.observable(serverDebugTimeLeft());
        this.addToDisposeList(
            serverDebugTimeLeft.subscribe(time => this.debugTimeLeft(time))
        );

        this.addToDisposeList(
            setInterval(
                () => {
                    if (this.debugMode()) {
                        this.debugTimeLeft(this.debugTimeLeft() - timeTickInterval);
                    }
                },
                timeTickInterval
            ),
            clearInterval
        );

        this.debugModeSheet = [
            {
                label: 'Debug Mode',
                template: 'textWithWarning',
                value: {
                    text: ko.pureComputed(() =>
                        this.debugMode() ? 'On' : 'Off'
                    ),
                    warning: ko.pureComputed(() =>
                        this.debugMode() ? 'May cause server slowdown' : ''
                    )
                }
            },
            {
                label: 'Time Left For Debugging',
                value: ko.pureComputed(
                    () => formatTimeLeftForDebugMode(this.debugMode(), this.debugTimeLeft())
                ),
                disabled: isTimeLeftDisabled
            }
        ];

        this.toggleDebugModeButtonLabel = ko.pureComputed(
            () => `Turn ${this.debugMode() ? 'Off' : 'On'} Server Debug Mode`
        );

        this.isCollectingDiagnostics = ko.pureComputed(
            () => this.server() && collectDiagnosticsState()[
                `server:${this.server().secret}`
            ]
        );
    }

    toggleDebugLevel() {
        const { secret, hostname } = this.server();
        setServerDebugLevel(secret, hostname, this.debugMode() ? 0 : 5);
    }

    downloadDiagnosticPack() {
        const { secret, hostname } = this.server();
        downloadServerDiagnosticPack(secret, hostname);
    }
}

export default {
    viewModel: ServerDiagnosticsFormViewModel,
    template: template
};
