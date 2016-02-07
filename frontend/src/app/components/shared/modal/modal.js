import template from './modal.html';
import { noop } from 'utils';

class ModalViewModal {
	constructor({ onClose = noop }) {
		this.onClose = onClose
	}
}

export default {
<<<<<<< HEAD
    template: template
=======
	viewModel: ModalViewModal,
	template: template
>>>>>>> 5899a610afcb3d598d4507eb1f86f1bfdcc9a9cb
}

