/* Copyright (C) 2016 NooBaa */

import template from './server-diagnostics-form.html';
import Observer from 'observer';
import ko from 'knockout';
import { get } from 'rx-extensions';
import { formatTimeLeftForDebugMode } from 'utils/diagnostic-utils';
import { timeTickInterval } from 'config';
import { action$, state$ } from 'state';
import {
    setServerDebugMode,
    collectServerDiagnostics
} from 'action-creators';

function _getToggleDebugModeButtonText(isTimeLeft) {
    return `Turn ${isTimeLeft ? 'Off' : 'On' } Server Debug Mode`;
}

function _getStateLabel(isTimeLeft) {
    return isTimeLeft ? 'On' : 'Off';
}

class ServerDiagnosticsFormViewModel extends Observer {
    isTimeLeft = false;
    server = null;
    timeLeft = ko.observable();
    isServerLoaded = ko.observable();
    toggleDebugModeButtonText = ko.observable();
    isCollectingDiagnostics = ko.observable();
    isConnected = ko.observable();
    debugModeSheet = [
        {
            label: 'Debug Mode',
            value: {
                stateLabel: ko.observable(),
                isWarningVisible: ko.observable()
            },
            template: 'debugState'
        },
        {
            label: 'Time Left For Debugging',
            value: ko.observable(),
            disabled: ko.observable()
        }
    ];


    constructor({ serverSecret }) {
        super();

        this.ticker = setInterval(this.onTick.bind(this), timeTickInterval);

        this.observe(
            state$.pipe(get('topology', 'servers', ko.unwrap(serverSecret))),
            this.onState
        );
    }

    onState(server) {
        if (!server) {
            this.isServerLoaded(false);
            this.isConnected(false);
            return;
        }

        const isConnected = server.mode === 'CONNECTED';
        const timeLeft = Math.max(server.debugMode.till - Date.now(), 0);
        const isTimeLeft = timeLeft !== 0;
        const timeLeftText = formatTimeLeftForDebugMode(isTimeLeft, timeLeft);

        this.server = server;
        this.isTimeLeft = isTimeLeft;
        this.isConnected(isConnected);
        this.isCollectingDiagnostics(server.diagnostics.collecting);
        this.timeLeft(timeLeft);
        this.toggleDebugModeButtonText(_getToggleDebugModeButtonText(isTimeLeft));
        this.debugModeSheet[0].value.stateLabel(_getStateLabel(isTimeLeft));
        this.debugModeSheet[0].value.isWarningVisible(isTimeLeft);
        this.debugModeSheet[1].disabled(!isTimeLeft);
        this.debugModeSheet[1].value(timeLeftText);
        this.isServerLoaded(true);
    }

    onToggleDebugMode() {
        const { secret, hostname } = this.server;
        action$.next(setServerDebugMode(secret, hostname, !this.isTimeLeft));
    }

    onDownloadDiagnosticPack() {
        const { secret, hostname } = this.server;
        action$.next(collectServerDiagnostics(secret, hostname));
    }

    onTick() {
        if (!this.timeLeft()) return;

        const timeLeft = Math.max(this.timeLeft() - timeTickInterval, 0);
        const isTimeLeft = timeLeft !== 0;
        const timeLeftText = formatTimeLeftForDebugMode(isTimeLeft, timeLeft);

        this.isTimeLeft = isTimeLeft;
        this.timeLeft(timeLeft);
        this.toggleDebugModeButtonText(_getToggleDebugModeButtonText(isTimeLeft));
        this.debugModeSheet[0].value.stateLabel(_getStateLabel(isTimeLeft));
        this.debugModeSheet[0].value.isWarningVisible(isTimeLeft);
        this.debugModeSheet[1].disabled(!isTimeLeft);
        this.debugModeSheet[1].value(timeLeftText);
    }

    dispose() {
        clearInterval(this.ticker);
        super.dispose();
    }
}

export default {
    viewModel: ServerDiagnosticsFormViewModel,
    template: template
};
