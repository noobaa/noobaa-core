import template from './modal.html';
import BaseViewModel from 'base-view-model';
import { noop } from 'utils';

class ModalViewModel extends BaseViewModel {
    constructor({ onClose = noop }) {
        super();

        this.onClose = onClose;
    }
}

export default {
    viewModel: ModalViewModel,
    template: template
};
