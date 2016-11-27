import template from './regenerate-account-credentials-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';

class RegenerateAccountCredentialsModalViewModel extends Disposable {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;

        this.password = ko.observable()
            .extend({
                required: { message: 'Password is required for security purposes' }
            });

        this.errors = ko.validation.group(this);
    }

    regenerate() {
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
    viewModel: RegenerateAccountCredentialsModalViewModel,
    template: template
};
