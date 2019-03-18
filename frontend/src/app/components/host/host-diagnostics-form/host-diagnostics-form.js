/* Copyright (C) 2016 NooBaa */

import template from './host-diagnostics-form.html';
import ko from 'knockout';
import ConnectableViewModel from 'components/connectable';
import { openTestNodeModal, collectHostDiagnostics, setHostDebugMode } from 'action-creators';
import { formatTimeLeftForDebugMode } from 'utils/diagnostic-utils';
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

class HostDiagnosticsFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    ticker = setInterval(this.onTick.bind(this), timeTickInterval);
    hostName = '';
    rpcAddress = '';
    actionsTooltip = ko.observable();
    areActionsDisabled = ko.observable();
    debugModeToggleText = ko.observable();
    isCollectingDiagnostics = ko.observable();
    debugState = false;
    timeLeftToDebugMode = undefined;
    debugDetails = [
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

    selectState(state, params) {
        return [
            state.hosts && state.hosts.items[params.name]
        ];
    }

    mapStateToProps(host) {
        if (!host) {
            ko.assignToProps(this, {
                dataReady: false,
                areActionsDisabled: true,
                actionsTooltip: {},
                debugModeToggleText: _getDebugModeToggleText(false)
            });

        } else {
            const { mode, debugMode, rpcAddress, diagnostics } = host;
            const isOffline = mode === 'OFFLINE';
            const isBeingDeleted = mode === 'DELETING';

            ko.assignToProps(this, {
                dataReady: true,
                hostName: host.name,
                rpcAddress: rpcAddress,
                actionsTooltip: _getActionsTooltip(isOffline, isBeingDeleted),
                areActionsDisabled: isOffline || isBeingDeleted,
                isCollectingDiagnostics: diagnostics.collecting,
                debugState: debugMode.state,
                timeLeftToDebugMode: debugMode.timeLeft,
                debugModeToggleText: _getDebugModeToggleText(debugMode.state),
                debugDetails: [
                    {
                        value: debugMode.state
                    },
                    {
                        value: formatTimeLeftForDebugMode(debugMode.state, debugMode.timeLeft),
                        disabled: !debugMode.state
                    }
                ]
            });
        }
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
        this.dispatch(setHostDebugMode(hostName, !debugState));
    }

    onDownloadDiagnostics() {
        this.dispatch(collectHostDiagnostics(this.hostName));
    }

    onRunTest() {
        this.dispatch(openTestNodeModal(this.rpcAddress));
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
