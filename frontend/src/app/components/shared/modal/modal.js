import template from './modal.html';
import Disposable from 'disposable';
import { noop } from 'utils';
import ko from 'knockout';

class ModalViewModel extends Disposable {
    constructor({
        title,
        onClose = noop,
        allowBackdropClose = true,
        addCloseButton = true
    }) {
        super();

        this.title = title;
        this.onClose = onClose;
        this.allowBackdropClose = allowBackdropClose;
        this.addCloseButton = addCloseButton;
    }

    backdropClick() {
        if (ko.unwrap(this.allowBackdropClose)) {
            this.onClose();
        }
    }
}

export default {
    viewModel: ModalViewModel,
    template: template
};
