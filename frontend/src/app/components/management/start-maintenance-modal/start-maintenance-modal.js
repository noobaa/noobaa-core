import template from './start-maintenance-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import  { enterMaintenanceMode } from 'actions';
import { deepFreeze } from 'utils';

const durationUntiOptions = deepFreeze([
    {
        label: 'Minutes',
        value: 1
    },
    {
        label: 'Hours',
        value: 60
    }
]);

class StartMaintenanceModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();
        this.onClose = onClose;

        this.duration = ko.observable(30)
            .extend({
                notEqual: {
                    params: '0',
                    message: 'Duration cannot be set to 00:00'
                }
            });

        this.durationUnit = ko.observable(1);
        this.durationUnitOptions = durationUntiOptions;

        this.durationInMin = ko.pureComputed(
            () => parseInt(this.duration()) * parseInt(this.durationUnit())
        );

        this.errors = ko.validation.group(this);
    }

    cancel() {
        this.onClose();
    }

    start() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            enterMaintenanceMode(this.durationInMin());
            this.onClose();
        }
    }
}

export default {
    viewModel: StartMaintenanceModalViewModel,
    template: template
};
