import template from './modal.html';
import { noop } from 'utils';

class ModalViewModal {
	constructor({ onClose = noop }) {
		this.onClose = onClose
	}
}

export default {
	viewModel: ModalViewModal,
	template: template
}

