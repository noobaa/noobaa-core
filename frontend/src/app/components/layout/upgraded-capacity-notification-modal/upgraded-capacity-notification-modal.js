import template from './upgraded-capacity-notification-modal.html';
import Disposable from 'disposable';
import { dismissUpgradedCapacityNotification } from 'actions';
import { realizeUri } from 'utils';
import { asset as assetRoute } from 'routes';

class UpgradedCapacityNotificationModalViewModel extends Disposable {
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

