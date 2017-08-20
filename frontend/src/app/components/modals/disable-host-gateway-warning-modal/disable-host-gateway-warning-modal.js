/* Copyright (C) 2016 NooBaa */

import template from './disable-host-gateway-warning-modal.html';
import Observer from 'observer';
import { action$ } from 'state';
import { toggleHostServices } from 'action-creators';
import ko from 'knockout';

class DisableHostGatewayWarningModalViewModel extends Observer {
    constructor({ onClose, name }) {
        super();

        this.close = onClose;
        this.hostName = ko.unwrap(name);
    }

    onApprove() {
        action$.onNext(toggleHostServices(this.hostName, { gateway: false }));
        this.close();
    }

    onCancel() {
        this.close();
    }
}

export default {
    viewModel: DisableHostGatewayWarningModalViewModel,
    template: template
};
