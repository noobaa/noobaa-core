/* Copyright (C) 2016 NooBaa */

import template from './object-preview-modal.html';
import BaseViewModel from 'components/base-view-model';

class ObjectPreviewModalViewModel extends BaseViewModel {
    constructor({ objectUri, onClose }) {
        super();

        this.uri = objectUri;
        this.onClose = onClose;
    }

    close() {
        this.onClose();
    }
}

export default {
    viewModel: ObjectPreviewModalViewModel,
    template: template
};
