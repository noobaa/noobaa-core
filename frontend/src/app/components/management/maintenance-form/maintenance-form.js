/* Copyright (C) 2016 NooBaa */

import template from './maintenance-form.html';
import Observer from 'observer';
import ko from 'knockout';
import { formatTimeLeftForMaintenanceMode } from 'utils/maintenance-utils';
import { realizeUri } from 'utils/browser-utils';
import { isUndefined } from 'utils/core-utils';
import { action$, state$ } from 'state';
import { getMany } from 'rx-extensions';
import * as routes from 'routes';
import { timeTickInterval } from 'config';
import {
    requestLocation,
    openStartMaintenanceModal,
    leaveMaintenanceMode
} from 'action-creators';

const sectionName = 'maintenance';

class MaintenanceFormViewModel extends Observer {
    timeLeft = ko.observable();
    isExpanded = ko.observable();
    stateText = ko.observable();
    timeLeftText = ko.observable();
    buttonText = ko.observable();

    constructor() {
        super();

        this.ticker = setInterval(this.onTick.bind(this), timeTickInterval);

        this.observe(
            state$.pipe(
                getMany(
                    ['system', 'timeLeftForMaintenanceMode'],
                    'location'
                )
            ),
            this.onState
        );
    }

    onState([timeLeft, location]) {
        if (isUndefined(timeLeft)) return;

        const { system, tab, section } = location.params;
        const toggleSection = section === sectionName ? undefined : sectionName;
        const toggleUri = realizeUri(
            routes.management,
            { system, tab, section: toggleSection }
        );
        const stateText = timeLeft !== 0 ? 'On' : 'Off';
        const buttonText = `Turn maintenance ${timeLeft ? 'off' : 'on'}`;

        this.timeLeft(timeLeft);
        this.stateText(stateText);
        this.buttonText(buttonText);
        this.isExpanded(section === sectionName);
        this.toggleUri = toggleUri;
    }

    onToggleSection() {
        action$.next(requestLocation(this.toggleUri));
    }

    onToggleMaintenance() {
        if (this.timeLeft()) {
            action$.next(leaveMaintenanceMode());
        } else {
            action$.next(openStartMaintenanceModal());
        }
    }

    onTick() {
        if (!this.timeLeft()) return;

        const timeLeft = Math.max(this.timeLeft() - timeTickInterval, 0);
        const timeLeftText = timeLeft > 0 ? formatTimeLeftForMaintenanceMode(timeLeft) : '';

        this.timeLeft(timeLeft);
        this.timeLeftText(timeLeftText);
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
