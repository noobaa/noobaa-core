import template from './upgraded-capacity-notification-modal.html';
import Disposable from 'disposable';
import { dismissUpgradedCapacityNotification } from 'actions';

class UpgradedCapacityNotificationModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
    }

    close() {
        dismissUpgradedCapacityNotification();
    }
}

export default {
    viewModel: UpgradedCapacityNotificationModalViewModel,
    template: template
};
