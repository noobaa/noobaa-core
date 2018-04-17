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

class DiagnosticsFormViewModel extends Observer {
    isDebugModeOn = false;
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
                target: '_self'
            },
            template: 'linkTemplate'
        },
        {
            label: 'Support center',
            value: {
                text: support.helpDesk,
                href: support.helpDesk,
                target: '_blank'
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
        const { timeLeft = 0, state: isDebugModeOn } = debugMode;
        const toggleDebugModeButtonText = `Turn ${isDebugModeOn ? 'Off' : 'On' } System Debug Mode`;
        const stateLabel = isDebugModeOn ? 'On' : 'Off';
        const isTimeLeft = Boolean(timeLeft);
        const timeLeftText = isDebugModeOn ? formatTimeLeftForDebugMode(isTimeLeft, timeLeft) : 'None';

        this.isDebugModeOn = isDebugModeOn;
        this.isCollectingDiagnostics(diagnostics.collecting);
        this.timeLeft(timeLeft);
        this.toggleDebugModeButtonText(toggleDebugModeButtonText);
        this.debugModeSheet[0].value.stateLabel(stateLabel);
        this.debugModeSheet[0].value.isWarningVisible(isDebugModeOn);
        this.debugModeSheet[1].disabled(!isDebugModeOn);
        this.debugModeSheet[1].value(timeLeftText);
        this.isSystemLoaded(true);
    }

    toggleDebugMode() {
        action$.next(setSystemDebugMode(!this.isDebugModeOn));
    }

    onDownloadDiagnosticPack() {
        action$.next(collectSystemDiagnostics());
    }

    onTick() {
        if (!this.timeLeft()) return;

        const timeLeft = Math.max(this.timeLeft() - timeTickInterval, 0);
        const isTimeLeft = Boolean(timeLeft);
        const timeLeftText = formatTimeLeftForDebugMode(isTimeLeft, timeLeft);

        this.timeLeft(timeLeft);
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
