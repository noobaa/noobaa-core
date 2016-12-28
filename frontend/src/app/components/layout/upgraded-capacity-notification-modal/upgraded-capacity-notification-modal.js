import template from './upgraded-capacity-notification-modal.html';
import BaseViewModel from 'base-view-model';
import { dismissUpgradedCapacityNotification } from 'actions';
import { realizeUri } from 'utils/all';
import { asset as assetRoute } from 'routes';

class UpgradedCapacityNotificationModalViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;

        this.giftImageUrl =  realizeUri(
            assetRoute,
            { asset: 'gift.png' }
        );
    }

    close() {
        dismissUpgradedCapacityNotification();
    }
}

export default {
    viewModel: UpgradedCapacityNotificationModalViewModel,
    template: template
};

