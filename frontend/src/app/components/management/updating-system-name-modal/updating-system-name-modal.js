import template from './updating-system-name-modal.html';
import Disposable from 'disposable';
import { updateHostname } from 'actions';
import ko from 'knockout';

class UpdatingSystemNameModalViewModel extends Disposable {
    constructor({ name, onClose }) {
        super();

        this.name = name;
        this.onClose = onClose;
        this.restarting = ko.observable(false);

        this.title = ko.pureComputed(
            // () => this.restarting() ? null : 'Updating System Name'
            () => 'Updating System Name'
        );
    }

    yes() {
        updateHostname(ko.unwrap(this.name));
        this.restarting(true);
    }

    no() {
        this.onClose();
    }
}

export default {
    viewModel: UpdatingSystemNameModalViewModel,
    template: template
};
