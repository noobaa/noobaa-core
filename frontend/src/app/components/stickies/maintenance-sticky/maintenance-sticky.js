/* Copyright (C) 2016 NooBaa */

import template from './maintenance-sticky.html';
import Observer from 'observer';
import ko from 'knockout';
import { formatTimeLeftForMaintenanceMode } from 'utils/maintenance-utils';
import { isUndefined } from 'utils/core-utils';
import { action$, state$ } from 'state';
import { timeTickInterval } from 'config';
import { leaveMaintenanceMode, refreshLocation } from 'action-creators';

class MaintenanceModeStickyViewModel extends Observer {
    isActive = ko.observable();
    timeLeft = ko.observable();
    timeLeftText = ko.observable();

    constructor() {
        super();

        this.ticker = setInterval(this.onTick.bind(this), timeTickInterval);

        this.observe(state$.get('system', 'timeLeftForMaintenanceMode'), this.onState);
    }

    onState(timeLeft) {
        if (isUndefined(timeLeft)) return;

        this.isActive(Boolean(timeLeft));
        this.timeLeft(timeLeft);
    }

    onTurnMaintenanceOff() {
        action$.onNext(leaveMaintenanceMode());
    }

    onTick() {
        if (!this.timeLeft()) return;

        const timeLeft = Math.max(this.timeLeft() - timeTickInterval, 0);
        const timeLeftText = timeLeft > 0 ? formatTimeLeftForMaintenanceMode(timeLeft) : '';

        this.timeLeft(timeLeft);
        this.timeLeftText(timeLeftText);
        timeLeft === 0 && action$.onNext(refreshLocation());
    }

    dispose() {
        clearInterval(this.ticker);
        super.dispose();
    }
}

export default {
    viewModel: MaintenanceModeStickyViewModel,
    template: template
};
