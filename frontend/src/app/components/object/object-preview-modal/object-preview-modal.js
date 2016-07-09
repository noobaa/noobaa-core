import template from './object-preview-modal.html';
import BaseViewModel from 'base-view-model';

class ObjectPreviewModalViewModel extends BaseViewModel {
    constructor({ uri, onClose }) {
        super();

        this.uri = uri;
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
