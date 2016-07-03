import template from './attach-server-modal.html';
import ko from 'knockout';
import { attachServerToCluster } from 'actions';

class AttachServerModalViewModel {
    constructor({ onClose }) {
        this.onClose = onClose;

        this.address = ko.observable()
            .extend({
                required: { message: 'Please enter a valid IP address or DNS name' },
                isIPOrDNSName: { message: 'Please enter a valid IP address or DNS name' }
            });

        this.secret = ko.observable()
            .extend({
                required: { message: 'Please enter the server secret' }
            });

        this.errors = ko.validation.group(this);
    }

    attach() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();

        } else {
            attachServerToCluster(this.address(), this.secret());
            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: AttachServerModalViewModel,
    template: template
};
