/* Copyright (C) 2016 NooBaa */

import template from './empty-bucket-placement-warning-modal.html';
import Observer from 'observer';
import { action$ } from 'state';
import { openEditBucketPlacementModal } from 'action-creators';

class EmptyBucketPlacementWarningModalViewModel extends Observer {
    constructor({ action, onClose }) {
        super();

        this.onClose = onClose;
        this.action = action;
    }

    onBack() {
        const { bucket } = this.action.payload;

        this.onClose();
        action$.onNext(openEditBucketPlacementModal(bucket));
    }

    onContinue() {
        this.onClose();
        action$.onNext(this.action);
    }
}

export default {
    viewModel: EmptyBucketPlacementWarningModalViewModel,
    template: template
};
