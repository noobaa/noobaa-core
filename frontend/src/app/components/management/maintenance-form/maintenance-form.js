/* Copyright (C) 2016 NooBaa */

import template from './maintenance-form.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import moment from 'moment';
import { systemInfo } from 'model';
import { exitMaintenanceMode } from 'actions';
import { pad } from 'utils/string-utils';
import { action$ } from 'state';
import { openStartMaintenanceModal } from 'action-creators';

class MaintenanceFormViewModel extends BaseViewModel {
    constructor({ isCollapsed }) {
        super();

        this.isCollapsed = isCollapsed;

        this.state = ko.pureComputed(
            () => !!systemInfo() && systemInfo().maintenance_mode.state
        );

        this.stateText = ko.pureComputed(
            () => this.state() ? 'On' : 'Off'
        );

        let till = ko.pureComputed(
            () => systemInfo() && systemInfo().maintenance_mode.till
        );

        let now = ko.observable(Date.now());

        this.timeLeftText = ko.pureComputed(
            () => {
                if (!till()) {
                    return;
                }

                let diff =  moment.duration(till() - now());
                return `${
                    pad(diff.days(), 2)
                }:${
                    pad(diff.hours(), 2)
                }:${
                    pad(diff.minutes(), 2)
                }:${
                    pad(diff.seconds(), 2)
                }`;
            }
        );

        this.buttonText = ko.pureComputed(
            () => `Turn maintenance ${this.state() ? 'off' : 'on' }`
        );

        this.isStartMaintenanceModalVisible = ko.observable(false);

        this.addToDisposeList(
            setInterval(
                () => now(Date.now()),
                1000
            ),
            clearInterval
        );
    }

    toggleMaintenance() {
        if (this.state()) {
            exitMaintenanceMode();
        } else {
            action$.onNext(openStartMaintenanceModal());
        }
    }
}

export default {
    viewModel: MaintenanceFormViewModel,
    template: template
};
