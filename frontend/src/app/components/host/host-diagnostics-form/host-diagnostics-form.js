/* Copyright (C) 2016 NooBaa */

import template from './host-diagnostics-form.html';
import ko from 'knockout';
import Observer from 'observer';
import { state$, action$ } from 'state';
import { openTestNodeModal, collectHostDiagnostics, setHostDebugMode } from 'action-creators';
import moment from 'moment';

function _getDebugModeToggleText(debugState) {
    return `Turn ${debugState ? 'off' : 'on'} node debug mode`;
}

function _getTimeLeftForDebugModeText(debugState, timeLeft) {
    if (!debugState) {
        return 'None';

    } else  if (timeLeft == null) {
        return 'Calculating...';

    } else {
        const duration = moment.duration(timeLeft);
        const minutes = String(duration.minutes()).padStart(2, 0);
        const seconds = String(duration.seconds()).padStart(2, 0);
        return `${minutes}:${seconds} minutes`;
    }
}

const debugInternval = 1000; // 1Sec

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

        this.observe(state$.get('hosts', 'items', this.hostName), this.onHost);

        // Create a ticker to update the debug counter each second.
        this.ticker = setInterval(this.onTick.bind(this), debugInternval);
    }

    onHost(host) {
        if (!host) {
            this.areActionsDisabled(true);
            this.debugModeToggleText(_getDebugModeToggleText(false));
            return;
        }

        const { mode, debugMode, rpcAddress, diagnostics } = host;
        const isOffline = mode === 'OFFLINE';
        const isBeingDeleted = mode === 'DELETING';
        const actionsTooltip =
            (isOffline && 'Node must be online for diagnostics operations') ||
            (isBeingDeleted && 'This operation is not available during node’s deletion') ||
            '';

        this.rpcAddress = rpcAddress;
        this.actionsTooltip(actionsTooltip);
        this.areActionsDisabled(isOffline || isBeingDeleted);
        this.isCollectingDiagnostics(diagnostics.collecting);

        this.debugState = debugMode.state;
        this.timeLeftToDebugMode = debugMode.timeLeft;
        this.debugModeToggleText(_getDebugModeToggleText(debugMode.state));
        this.debugDetails[0].value(debugMode.state);
        this.debugDetails[1].value(_getTimeLeftForDebugModeText(debugMode.state, debugMode.timeLeft));
        this.debugDetails[1].disabled(!debugMode.state);

        this.hostLoaded(true);
    }

    onTick() {
        const { debugState, timeLeftToDebugMode } = this;
        if (!debugState || !timeLeftToDebugMode || timeLeftToDebugMode < debugInternval) return;

        this.timeLeftToDebugMode = timeLeftToDebugMode - debugInternval;
        const text = _getTimeLeftForDebugModeText(debugState, timeLeftToDebugMode);
        this.debugDetails[1].value(text);
    }

    onToggleDebugMode() {
        const { hostName, debugState } = this;
        action$.onNext(setHostDebugMode(hostName, !debugState));
    }

    onDownloadDiagnostics() {
        action$.onNext(collectHostDiagnostics(this.hostName));
    }

    onRunTest() {
        action$.onNext(openTestNodeModal(this.rpcAddress));
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
