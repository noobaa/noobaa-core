import template from './object-preview-modal.html';

class ObjectPreviewModalViewModel {
	constructor({ uri, onClose }) {
		this.uri = uri;
		this.onClose = onClose;
	}
}

export default {
	viewModel: ObjectPreviewModalViewModel,
	template: template
}