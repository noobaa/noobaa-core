import template from './cloud-resource-deleted-alert-modal.html';
import Disposable from 'disposable';

class CloudResourceDeletedAlertModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();
        this.onClose = onClose;
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: CloudResourceDeletedAlertModalViewModel,
    template: template
};
