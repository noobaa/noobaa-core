/* Copyright (C) 2016 NooBaa */

import template from './maintenance-sticky.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { formatTimeLeftForMaintenanceMode } from 'utils/maintenance-utils';
import { timeTickInterval } from 'config';
import { leaveMaintenanceMode, refreshLocation } from 'action-creators';

class MaintenanceModeStickyViewModel extends ConnectableViewModel {
    isActive = ko.observable();
    timeLeft = ko.observable();
    formattedTimeLeft = ko.observable();

    constructor(params, inject) {
        super(params, inject);

        this.ticker = setInterval(
            () => this.onTick(),
            timeTickInterval
        );
    }

    selectState(state) {
        return [
            state.system && state.system.maintenanceMode
        ];
    }

    mapStateToProps(maintenanceMode) {
        if (!maintenanceMode) {
            ko.assignToProps(this, {
                isActive: false
            });

        } else {
            const timeLeft = Math.max(maintenanceMode.till - Date.now(), 0);
            const formattedTimeLeft = formatTimeLeftForMaintenanceMode(timeLeft);

            ko.assignToProps(this, {
                isActive: Boolean(timeLeft),
                timeLeft,
                formattedTimeLeft
            });
        }
    }

    onTurnMaintenanceOff() {
        this.dispatch(leaveMaintenanceMode());
    }

    onTick() {
        if (!this.timeLeft()) {
            return;
        }

        const timeLeft = Math.max(this.timeLeft() - timeTickInterval, 0);
        const formattedTimeLeft = formatTimeLeftForMaintenanceMode(timeLeft);

        if (timeLeft === 0) {
            this.dispatch(refreshLocation());
        }

        ko.assignToProps(this, {
            timeLeft,
            formattedTimeLeft
        });
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
