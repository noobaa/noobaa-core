/* Copyright (C) 2016 NooBaa */

import template from './diagnostics-form.html';
import Observer from 'observer';
import ko from 'knockout';
import { get } from 'rx-extensions';
import { formatTimeLeftForDebugMode } from 'utils/diagnostic-utils';
import { support, timeTickInterval } from 'config';
import { action$, state$ } from 'state';
import {
    setSystemDebugMode,
    collectSystemDiagnostics
} from 'action-creators';

function _getToggleDebugModeButtonText(isTimeLeft) {
    return `Turn ${isTimeLeft ? 'Off' : 'On' } System Debug Mode`;
}

function _getStateLabel(isTimeLeft) {
    return isTimeLeft ? 'On' : 'Off';
}

class DiagnosticsFormViewModel extends Observer {
    isTimeLeft = false;
    timeLeft = ko.observable();
    isSystemLoaded = ko.observable();
    toggleDebugModeButtonText = ko.observable();
    isCollectingDiagnostics = ko.observable();
    contactInfo = [
        {
            label: 'By email',
            value:  {
                text: support.email,
                href: `mailto:${support.email}`,
                openInNewTab: false
            },
            template: 'linkTemplate'
        },
        {
            label: 'Support center',
            value: {
                text: support.helpDesk,
                href: support.helpDesk,
                openInNewTab: true
            },
            template: 'linkTemplate'
        }
    ];
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

    constructor() {
        super();

        this.ticker = setInterval(this.onTick.bind(this), timeTickInterval);

        this.observe(
            state$.pipe(get('system')),
            this.onState
        );

    }

    onState(system) {
        if (!system) {
            this.isSystemLoaded(false);
            this.isCollectingDiagnostics(false);
            this.toggleDebugModeButtonText('Turn On System Debug Mode');
            return;
        }

        const { debugMode, diagnostics } = system;
        const timeLeft = Math.max(debugMode.till - Date.now(), 0);
        const isTimeLeft = timeLeft !== 0;
        const timeLeftText = formatTimeLeftForDebugMode(isTimeLeft, timeLeft);

        this.isTimeLeft = isTimeLeft;
        this.isCollectingDiagnostics(diagnostics.collecting);
        this.timeLeft(timeLeft);
        this.toggleDebugModeButtonText(_getToggleDebugModeButtonText(isTimeLeft));
        this.debugModeSheet[0].value.stateLabel(_getStateLabel(isTimeLeft));
        this.debugModeSheet[0].value.isWarningVisible(isTimeLeft);
        this.debugModeSheet[1].disabled(!isTimeLeft);
        this.debugModeSheet[1].value(timeLeftText);
        this.isSystemLoaded(true);
    }

    toggleDebugMode() {
        action$.next(setSystemDebugMode(!this.isTimeLeft));
    }

    onDownloadDiagnosticPack() {
        action$.next(collectSystemDiagnostics());
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
    viewModel: DiagnosticsFormViewModel,
    template: template
};
