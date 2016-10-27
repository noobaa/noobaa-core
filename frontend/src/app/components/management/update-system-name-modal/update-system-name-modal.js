import template from './update-system-name-modal.html';
import Disposable from 'disposable';
import { updateHostname } from 'actions';
import ko from 'knockout';

class UpdatingSystemNameModalViewModel extends Disposable {
    constructor({ name, onClose }) {
        super();

        this.name = name;
        this.onClose = onClose;
        this.updating = ko.observable(false);
    }

    update() {
        this.updating(true);
        updateHostname(ko.unwrap(this.name));
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: UpdatingSystemNameModalViewModel,
    template: template
};
