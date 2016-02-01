import template from './object-preview-modal.html';

class ObjectPreviewModalViewModel {
	constructor({ uri, onClose }) {
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
}