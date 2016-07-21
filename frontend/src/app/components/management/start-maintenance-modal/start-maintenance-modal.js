import template from './start-maintenance-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import  { enterMaintenanceMode } from 'actions';

class StartMaintenanceModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();
        this.onClose = onClose;

        this.hours = ko.observable(0);
        this.minutes =  ko.observable(30);

        this.duration = ko.pureComputed(
            () => parseInt(this.hours()) * 60 + parseInt(this.minutes())
        ).extend({
            notEqual: {
                params: 0,
                message: 'Maintenance mode duration cannot be 00:00'
            }
        });

        this.errors = ko.validation.group(this);
    }

    cancel() {
        this.onClose();
    }

    start() {
        console.warn(this.duration());
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            enterMaintenanceMode(this.duration());
            this.onClose();
        }
    }
}

export default {
    viewModel: StartMaintenanceModalViewModel,
    template: template
};
