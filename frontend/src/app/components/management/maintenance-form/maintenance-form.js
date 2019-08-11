/* Copyright (C) 2016 NooBaa */

import template from './maintenance-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { formatTimeLeftForMaintenanceMode } from 'utils/maintenance-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import { timeTickInterval } from 'config';
import {
    requestLocation,
    openStartMaintenanceModal,
    leaveMaintenanceMode
} from 'action-creators';

const sectionName = 'maintenance';

class MaintenanceFormViewModel extends ConnectableViewModel {
    dataReady = false;
    toggleUri = '';
    isExpanded = ko.observable();
    stateText = ko.observable();
    buttonText = ko.observable();
    timeLeft = 0;
    hasTimeLeft = ko.observable();
    formattedTime = ko.observable();


    constructor(params, inject) {
        super(params, inject);

        this.ticker = setInterval(
            () => this.onTick(),
            timeTickInterval
        );
    }

    selectState(state) {
        const { system, location } = state;
        return [
            system && system.maintenanceMode,
            location
        ];
    }

    mapStateToProps(maintenanceMode, location) {
        if (!maintenanceMode) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const timeLeft = Math.max(maintenanceMode.till - Date.now(), 0);
            const { system, section } = location.params;
            const toggleSection = section === sectionName ? undefined : sectionName;
            const toggleUri = realizeUri(routes.management, { system, tab: 'settings', section: toggleSection });
            const stateText = timeLeft !== 0 ? 'On' : 'Off';
            const buttonText = `Turn maintenance ${timeLeft ? 'off' : 'on'}`;

            ko.assignToProps(this, {
                dataReady: true,
                toggleUri,
                isExpanded: section === sectionName,
                stateText,
                buttonText,
                timeLeft,
                hasTimeLeft: timeLeft > 0,
                formattedTime: formatTimeLeftForMaintenanceMode(timeLeft)
            });
        }
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }

    onToggleMaintenance() {
        const action = this.hasTimeLeft() ?
            leaveMaintenanceMode() :
            openStartMaintenanceModal();

        this.dispatch(action);
    }

    onTick() {
        if (!this.dataReady && this.timeLeft <= 0) {
            return;
        }

        const newTimeLeft = Math.max(this.timeLeft - timeTickInterval, 0);
        ko.assignToProps(this, {
            timeLeft: newTimeLeft,
            hasTimeLeft: newTimeLeft > 0,
            formattedTime: formatTimeLeftForMaintenanceMode(newTimeLeft)
        });
    }

    dispose() {
        clearInterval(this.ticker);
        super.dispose();
    }
}

export default {
    viewModel: MaintenanceFormViewModel,
    template: template
};
