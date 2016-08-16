import template from './maintenance-sticky.html';
import Disposable from 'disposable';
import ko from 'knockout';
import moment from 'moment';
import { systemInfo } from 'model';
import { exitMaintenanceMode } from 'actions';
import { pad } from 'utils';

class MaintenanceModeStickyViewModel extends Disposable{
    constructor() {
        super();

        this.isActive = ko.pureComputed(
            () => !!systemInfo() && systemInfo().maintenance_mode.state
        );

        let now = ko.observable(Date.now());
        this.addToDisposeList(
            setInterval(
                () => now(Date.now())
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
    }

    exitMaintenance() {
        exitMaintenanceMode();
    }
}

export default {
    viewModel: MaintenanceModeStickyViewModel,
    template: template
};
