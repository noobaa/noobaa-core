import template from './object-preview-modal.html';
import Disposable from 'disposable';

class ObjectPreviewModalViewModel extends Disposable {
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
