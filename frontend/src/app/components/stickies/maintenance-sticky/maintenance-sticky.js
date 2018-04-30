/* Copyright (C) 2016 NooBaa */

import template from './maintenance-sticky.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import moment from 'moment';
import { systemInfo } from 'model';
import { exitMaintenanceMode } from 'actions';
import { pad } from 'utils/string-utils';

class MaintenanceModeStickyViewModel extends BaseViewModel {
    constructor() {
        super();

        this.isActive = ko.pureComputed(
            () => !!systemInfo() && systemInfo().maintenance_mode.state
        );

        let now = ko.observable(Date.now());
        this.addToDisposeList(
            setInterval(
                () => now(Date.now()), 1000
            ),
            clearInterval
        );

        let till = ko.pureComputed(
            () => systemInfo() && systemInfo().maintenance_mode.till
        );

        this.timeLeftText = ko.pureComputed(
            () => {
                if (!till()) {
                    return;
                }

                let diff =  moment.duration(Math.max(till() - now(),0));

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
    }

    exitMaintenance() {
        exitMaintenanceMode();
    }
}

export default {
    viewModel: MaintenanceModeStickyViewModel,
    template: template
};
