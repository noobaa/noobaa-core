/* Copyright (C) 2016 NooBaa */

import template from './disable-host-storage-warning-modal.html';
import Observer from 'observer';

class DisableHostStorageWarningModalViewModel extends Observer {
    constructor({ onClose }) {
        super();
        this.close = onClose;
    }

    onApprove() {
        this.close();
    }

    onBack() {
        this.close();
    }
}

export default {
    viewModel: DisableHostStorageWarningModalViewModel,
    template: template
};
