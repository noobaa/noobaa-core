import template from './modal.html';
import Disposable from 'disposable';
import { noop } from 'utils';

class ModalViewModel extends Disposable {
    constructor({ onClose = noop }) {
        super();

        this.onClose = onClose;
    }
}

export default {
    viewModel: ModalViewModel,
    template: template
};
