/* Copyright (C) 2016 NooBaa */

import template from './disable-host-endpoint-warning-modal.html';
import Observer from 'observer';
import { action$ } from 'state';
import { toggleHostServices } from 'action-creators';
import ko from 'knockout';

class DisableHostEndpointWarningModalViewModel extends Observer {
    constructor({ onClose, host, isLastService }) {
        super();

        this.close = onClose;
        this.hostName = ko.unwrap(host);
        this.isLastService = ko.unwrap(isLastService);
    }

    onApprove() {
        action$.next(toggleHostServices(this.hostName, { endpoint: false }));
        this.close();
    }

    onCancel() {
        this.close();
    }
}

export default {
    viewModel: DisableHostEndpointWarningModalViewModel,
    template: template
};
