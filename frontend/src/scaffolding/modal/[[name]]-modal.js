import template from './[[name]]-modal.html';
// import ko from 'knockout';
// import numeral from 'numeral';
// import moment from 'moment';

class [[nameCammelCased]]ModalViewModel {
    constructor({ onClose }) {
        this.onClose = onClose;
    }

    [[action]]() {
        this.onClose();
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: [[nameCammelCased]]ModalViewModel,
    tempalte: template
};
