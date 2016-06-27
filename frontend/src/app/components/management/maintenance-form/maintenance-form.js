import template from './maintenance-form.html';
import ko from 'knockout';
import moment from 'moment';
import { systemInfo } from 'model';
import { exitMaintenanceMode } from 'actions';
import { pad } from 'utils';

class MaintenanceFormViewModel {
    constructor() {
        this.expanded = ko.observable(false);

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
                if (till()) {
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
            }
        );

        this.buttonText = ko.pureComputed(
            () => `Turn maintenance ${this.state() ? 'off' : 'on' }`
        );

        this.isStartMaintenanceModalVisible = ko.observable(false);

        setInterval(
            () => now(Date.now()),
            1000
        );
    }

    toggleMaintenance() {
        if (this.state()) {
            exitMaintenanceMode();
        } else {
            this.isStartMaintenanceModalVisible(true);
        }
    }

    hideStartMaintenanceModal() {
        this.isStartMaintenanceModalVisible(false);
    }
}

export default {
    viewModel: MaintenanceFormViewModel,
    template: template
};
