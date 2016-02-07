import template from './object-preview-modal.html';

class ObjectPreviewModalViewModel {
<<<<<<< HEAD
    constructor({ uri, onClose }) {
        this.uri = uri;
        this.onClose = onClose;
    }
=======
	constructor({ uri, onClose }) {
		this.uri = uri;
		this.onClose = onClose;
	}

	close() {
		this.onClose();
	}
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb
}

export default {
    viewModel: ObjectPreviewModalViewModel,
    template: template
}