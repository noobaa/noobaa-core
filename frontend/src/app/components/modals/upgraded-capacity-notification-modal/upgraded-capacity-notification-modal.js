/* Copyright (C) 2016 NooBaa */

import template from './upgraded-capacity-notification-modal.html';
import { dismissUpgradedCapacityNotification } from 'actions';
import { realizeUri } from 'utils/browser-utils';
import { action$ } from 'state';
import { closeModal } from 'action-creators';
import { asset as assetRoute } from 'routes';


class UpgradedCapacityNotificationModalViewModel {
    constructor() {

        this.giftImageUrl =  realizeUri(assetRoute, { asset: 'gift.png' });
    }

    onClose() {
        dismissUpgradedCapacityNotification();
        action$.onNext(closeModal());
    }
}

export default {
    viewModel: UpgradedCapacityNotificationModalViewModel,
    template: template
};

