/* Copyright (C) 2016 NooBaa */

import template from './object-preview-modal.html';
import { action$ } from 'state';
import { closeModal } from 'action-creators';

class ObjectPreviewModalViewModel {
    uri = '';

    constructor({ objectUri }) {
        this.uri = objectUri;
    }

    onClose() {
        action$.onNext(closeModal());
    }
}

export default {
    viewModel: ObjectPreviewModalViewModel,
    template: template
};
