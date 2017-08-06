/* Copyright (C) 2016 NooBaa */

import template from './host-diagnostics-form.html';
import ko from 'knockout';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { openTestNodeModal, collectHostDiagnostics, setHostDebugMode } from 'action-creators';

function _getDebugModeToggleText(debugMode) {
    return `Turn ${debugMode ? 'off' : 'on'} node debug mode`;
}

class HostDiagnosticsFormViewModel extends Observer{
    constructor({ name }) {
        super();

        this.hostName = ko.unwrap(name);
        this.hostLoaded = ko.observable(false);
        this.rpcAddress = '';
        this.debugMode = false;
        this.actionsTooltip = ko.observable();
        this.areActionsDisabled = ko.observable();
        this.debugModeToggleText = ko.observable();
        this.isCollectingDiagnostics = ko.observable();
        this.debugModeState = ko.observable();
        this.timeLeftForDebugMode = ko.observable();
        this.isDebugDetailsDisabled = ko.observable();
        this.debugDetails = [
            {
                label: 'Debug Mode',
                value: this.debugModeState
            },
            {
                label: 'Time left for debugging',
                value: this.timeLeftForDebugMode,
                disabled: this.isDebugDetailsDisabled
            }
        ];

        this.observe(state$.get('hosts', 'items', this.hostName), this.onHost);
    }

    onHost(host) {
        if (!host) {
            this.debugModeToggleText(_getDebugModeToggleText(false));
            this.areActionsDisabled(true);
            return;
        }

        const { mode, debugMode, rpcAddress, diagnostics } = host;
        const isOffline = mode === 'OFFLINE';
        this.rpcAddress = rpcAddress;
        this.debugMode = debugMode;
        this.actionsTooltip(isOffline ? 'Node must be online for diagnostics operations' : '');
        this.areActionsDisabled(isOffline);
        this.debugModeToggleText(_getDebugModeToggleText(debugMode));
        this.isCollectingDiagnostics(diagnostics.collecting);
        this.debugModeState(debugMode ? 'On' : 'Off');
        this.timeLeftForDebugMode(debugMode ? '???' : 'None');
        this.isDebugDetailsDisabled(!debugMode);
        this.hostLoaded(true);
    }

    onToggleDebugMode() {
        action$.onNext(setHostDebugMode(this.hostName, !this.debugMode));
    }

    onDownloadDiagnostics() {
        action$.onNext(collectHostDiagnostics(this.hostName));
    }

    onRunTest() {
        action$.onNext(openTestNodeModal(this.rpcAddress));
    }
}

export default {
    viewModel: HostDiagnosticsFormViewModel,
    template: template
};
