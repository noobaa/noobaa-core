import template from './[[name]]-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
// import numeral from 'numeral';
// import moment from 'moment';

class [[nameCammelCased]]ModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
        this.errors = ko.validation.group(this);
    }

    [[action]]() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: [[nameCammelCased]]ModalViewModel,
    template: template
};
