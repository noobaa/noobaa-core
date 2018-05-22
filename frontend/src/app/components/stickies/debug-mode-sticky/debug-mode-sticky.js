/* Copyright (C) 2016 NooBaa */

import template from './debug-mode-sticky.html';
import Observer from 'observer';
import ko from 'knockout';
import { get } from 'rx-extensions';
import { formatTimeLeftForDebugMode } from 'utils/diagnostic-utils';
import { timeTickInterval } from 'config';
import { action$, state$ } from 'state';
import { setSystemDebugMode } from 'action-creators';

class DebugModeStickyViewModel extends Observer {
    isActive = ko.observable();
    timeLeft = ko.observable();
    timeLeftText = ko.observable();

    constructor() {
        super();

        this.ticker = setInterval(this.onTick.bind(this), timeTickInterval);

        this.observe(
            state$.pipe(get('system', 'debugMode')),
            this.onState
        );
    }

    onState(debugMode) {
        if (!debugMode) return;

        const timeLeft = Math.max(debugMode.till - Date.now(), 0);
        const isTimeLeft = timeLeft !== 0;
        const timeLeftText = formatTimeLeftForDebugMode(isTimeLeft, timeLeft);

        this.isActive(isTimeLeft);
        this.timeLeft(timeLeft);
        this.timeLeftText(timeLeftText);
    }

    onTurnOffDebugMode() {
        action$.next(setSystemDebugMode(false));
    }

    onTick() {
        if (!this.timeLeft()) return;

        const timeLeft = Math.max(this.timeLeft() - timeTickInterval, 0);
        const isTimeLeft = timeLeft !== 0;
        const timeLeftText = formatTimeLeftForDebugMode(isTimeLeft, timeLeft);

        this.timeLeft(timeLeft);
        this.timeLeftText(timeLeftText);
        this.isActive(isTimeLeft);
    }

    dispose() {
        clearInterval(this.ticker);
        super.dispose();
    }
}

export default {
    viewModel: DebugModeStickyViewModel,
    template: template
};

