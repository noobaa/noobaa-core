/* Copyright (C) 2016 NooBaa */

import template from './disable-host-last-service-warning-modal.html';
import Observer from 'observer';
import { action$ } from 'state';
import { toggleHostServices } from 'action-creators';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';

const serviceToServiceName = deepFreeze({
    storage: 'Storage',
    gateway: 'S3 Gateway'
});

class DisableHostLastServiceWarningModalViewModel extends Observer {
    constructor({ onClose, host, service }) {
        super();

        this.close = onClose;
        this.hostName = ko.unwrap(host);
        this.service = ko.unwrap(service);
        this.serviceName = serviceToServiceName[this.service];
    }

    onApprove() {
        const { hostName, service } = this;
        action$.onNext(toggleHostServices(hostName, { [service]: false }));
        this.close();
    }

    onCancel() {
        this.close();
    }
}

export default {
    viewModel: DisableHostLastServiceWarningModalViewModel,
    template: template
};
