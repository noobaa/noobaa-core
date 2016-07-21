import template from './modal.html';
import Disposable from 'disposable';
import { noop } from 'utils';

class ModalViewModel extends Disposable {
    constructor({ onClose = noop , closeButton = true }) {
        super();

        this.onClose = onClose;
        this.closeButton = closeButton;
    }
}

export default {
    viewModel: ModalViewModel,
    template: template
};
