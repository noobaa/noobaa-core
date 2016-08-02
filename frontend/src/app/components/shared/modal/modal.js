import template from './modal.html';
import Disposable from 'disposable';
import { noop } from 'utils';

class ModalViewModel extends Disposable {
    constructor({
        title,
        onClose = noop
    }) {
        super();

        this.title = title;
        this.onClose = onClose;
    }
}

export default {
    viewModel: ModalViewModel,
    template: template
};
