import template from './aws-credentials-modal.html';
import ko from 'knockout';
import { addAWSCredentials } from 'actions';

class AWSCredentialsModalViewModel {
    constructor({ onClose }) {
        this.onClose = onClose;

        this.accessKey = ko.observable()
            .extend({ required: true });

        this.secretKey = ko.observable()
            .extend({ required: true });

        this.errors = ko.validation.group({
            accessKey: this.accessKey,
            secretKey: this.secretKey
        });
    }

    save() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
            addAWSCredentials(this.accessKey(), this.secretKey());
            this.onClose();
        }
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: AWSCredentialsModalViewModel,
    template: template
}