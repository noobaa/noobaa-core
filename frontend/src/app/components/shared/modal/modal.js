import template from './modal.html';
import { noop } from 'utils';

class ModalViewModel {
    constructor({ onClose = noop }) {
        this.onClose = onClose;
    }
}

export default {
    viewModel: ModalViewModel,
    template: template
};
