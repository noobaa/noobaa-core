/* Copyright (C) 2016 NooBaa */

import template from './server-diagnostics-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo, collectDiagnosticsState } from 'model';
import { downloadServerDiagnosticPack, setServerDebugLevel } from 'actions';

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

        this.debugModeSheet = [
            {
                label: 'Debug Mode',
                value: ko.pureComputed(
                    () => this.debugMode() ?
                        'On <span class="warning">(May cause server slowdown)</span>' :
                        'Off'
                )
            },
            {
                label: 'Time Left For Debugging',
                value: ko.pureComputed(
                    () => 'None'
                ),
                disabled: true
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
