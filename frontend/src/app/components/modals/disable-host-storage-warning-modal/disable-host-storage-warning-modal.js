/* Copyright (C) 2016 NooBaa */

import template from './disable-host-storage-warning-modal.html';
import Observer from 'observer';
import { action$ } from 'state';
import { toggleHostServices, openEditHostStorageDrivesModal } from 'action-creators';
import ko from 'knockout';

class DisableHostStorageWarningModalViewModel extends Observer {
    constructor({ onClose, host, isLastService }) {
        super();

        this.close = onClose;
        this.host = ko.unwrap(host);
        this.isLastService = ko.unwrap(isLastService);
    }

    onApprove() {
        this.close();
        action$.next(toggleHostServices(this.host, { storage: false }));
    }

    onBack() {
        this.close();
        action$.next(openEditHostStorageDrivesModal(this.host, this.isLastService));
    }
}

export default {
    viewModel: DisableHostStorageWarningModalViewModel,
    template: template
};
