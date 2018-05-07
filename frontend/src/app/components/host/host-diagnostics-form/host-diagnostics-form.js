/* Copyright (C) 2016 NooBaa */

import template from './host-diagnostics-form.html';
import ko from 'knockout';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { openTestNodeModal, collectHostDiagnostics, setHostDebugMode } from 'action-creators';
import { formatTimeLeftForDebugMode } from 'utils/diagnostic-utils';
import { get } from 'rx-extensions';
import { timeTickInterval } from 'config';

function _getDebugModeToggleText(debugState) {
    return `Turn ${debugState ? 'off' : 'on'} node debug mode`;
}

function _getActionsTooltip(isOffline, isBeingDeleted) {
    const text =
        (isOffline && 'Node must be online for diagnostics operations') ||
        (isBeingDeleted && 'This operation is not available during node’s deletion') ||
        '';

    return text && {
        text: text,
        align: 'end'
    };
}

class HostDiagnosticsFormViewModel extends Observer{
    constructor({ name }) {
        super();

        this.hostName = ko.unwrap(name);
        this.hostLoaded = ko.observable(false);
        this.rpcAddress = '';
        this.actionsTooltip = ko.observable();
        this.areActionsDisabled = ko.observable();
        this.debugModeToggleText = ko.observable();
        this.isCollectingDiagnostics = ko.observable();
        this.debugState = false;
        this.timeLeftToDebugMode = undefined;
        this.debugDetails = [
            {
                label: 'Debug Mode',
                value: ko.observable(),
                template: 'debugMode'
            },
            {
                label: 'Time left for debugging',
                value: ko.observable(),
                disabled: ko.observable()
            }
        ];

        this.observe(
            state$.pipe(get('hosts', 'items', this.hostName)),
            this.onHost
        );

        // Create a ticker to update the debug counter each second.
        this.ticker = setInterval(this.onTick.bind(this), timeTickInterval);
    }

    onHost(host) {
        if (!host) {
            this.areActionsDisabled(true);
            this.actionsTooltip({});
            this.debugModeToggleText(_getDebugModeToggleText(false));
            return;
        }

        const { mode, debugMode, rpcAddress, diagnostics } = host;
        const isOffline = mode === 'OFFLINE';
        const isBeingDeleted = mode === 'DELETING';

        this.rpcAddress = rpcAddress;
        this.actionsTooltip(_getActionsTooltip(isOffline, isBeingDeleted));
        this.areActionsDisabled(isOffline || isBeingDeleted);
        this.isCollectingDiagnostics(diagnostics.collecting);

        this.debugState = debugMode.state;
        this.timeLeftToDebugMode = debugMode.timeLeft;
        this.debugModeToggleText(_getDebugModeToggleText(debugMode.state));
        this.debugDetails[0].value(debugMode.state);
        this.debugDetails[1].value(formatTimeLeftForDebugMode(debugMode.state, debugMode.timeLeft));
        this.debugDetails[1].disabled(!debugMode.state);

        this.hostLoaded(true);
    }

    onTick() {
        const { debugState, timeLeftToDebugMode } = this;
        if (!debugState || !timeLeftToDebugMode || timeLeftToDebugMode < timeTickInterval) return;

        this.timeLeftToDebugMode = timeLeftToDebugMode - timeTickInterval;
        const text = formatTimeLeftForDebugMode(debugState, timeLeftToDebugMode);
        this.debugDetails[1].value(text);
    }

    onToggleDebugMode() {
        const { hostName, debugState } = this;
        action$.next(setHostDebugMode(hostName, !debugState));
    }

    onDownloadDiagnostics() {
        action$.next(collectHostDiagnostics(this.hostName));
    }

    onRunTest() {
        action$.next(openTestNodeModal(this.rpcAddress));
    }

    dispose(){
        clearInterval(this.ticker);
        super.dispose();
    }
}

export default {
    viewModel: HostDiagnosticsFormViewModel,
    template: template
};
