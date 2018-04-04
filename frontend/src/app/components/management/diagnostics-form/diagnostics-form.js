/* Copyright (C) 2016 NooBaa */

import template from './diagnostics-form.html';
import Observer from 'observer';
import ko from 'knockout';
import { formatTimeLeftForDebugMode } from 'utils/diagnostic-utils';
import { support, timeTickInterval } from 'config';
import { action$, state$ } from 'state';
import {
    setSystemDebugMode,
    unsetSystemDebugMode,
    collectSystemDiagnostics
} from 'action-creators';


class DiagnosticsFormViewModel extends Observer {
    timeLeft = ko.observable();
    systemLoaded = ko.observable();
    buttonText = ko.observable();
    isCollectingDiagnostics = ko.observable();
    contactSupport = [
        {
            label: 'By email',
            value: support.email,
            template: 'emailLink'
        },
        {
            label: 'Support center',
            value: support.helpDesk,
            template: 'helpDeskLink'
        }
    ];
    debugModeSheet = [
        {
            label: 'Debug Mode',
            value: ko.observable(),
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

        this.observe(state$.get('system'), this.onState);
    }

    onState(systemState) {
        if (!systemState) {
            this.systemLoaded(false);
            this.isCollectingDiagnostics(false);
            return;
        }

        const { debugMode, diagnostics } = systemState;
        const isDebugMode = Boolean(debugMode);
        const buttonText = `Turn ${isDebugMode ? 'Off' : 'On' } System Debug Mode`;

        this.isCollectingDiagnostics(diagnostics.collecting);
        this.timeLeft(debugMode);
        this.buttonText(buttonText);
        this.debugModeSheet[0].value(isDebugMode);
        this.debugModeSheet[1].disabled(!isDebugMode);
        this.debugModeSheet[1].value(isDebugMode ?
            formatTimeLeftForDebugMode(isDebugMode, debugMode) :
            'None'
        );
        this.systemLoaded(true);
    }

    toogleDebugMode() {
        const action = this.timeLeft() ? unsetSystemDebugMode : setSystemDebugMode;
        const level = this.timeLeft && 5;
        action$.onNext(action(level));
    }

    downloadDiagnosticPack() {
        action$.onNext(collectSystemDiagnostics());
    }

    onTick() {
        if (!this.timeLeft()) return;

        const diff = this.timeLeft() - timeTickInterval;
        const timeLeft = diff > 0 ? diff : undefined;
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
