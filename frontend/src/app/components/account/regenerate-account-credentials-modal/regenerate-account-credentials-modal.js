import template from './regenerate-account-credentials-modal.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { regenerateAccountCredentials } from 'actions';
import { regenerateCredentialState } from 'model';

class RegenerateAccountCredentialsModalViewModel extends Disposable {
    constructor({ onClose, email }) {
        super();

        this.onClose = onClose;
        this.email = email;
        this.password = ko.observable()
            .extend({
                required: { message: 'Password is required for security purposes' },
                validation: {
                    validator: () => touched() || regenerateCredentialState() !== 'UNAUTHORIZED',
                    message: 'Please make sure your password is correct'
                }
            });

        this.errors = ko.validation.group(this);

        const touched = ko.touched([this.password]);
        this.addToDisposeList(
            regenerateCredentialState.subscribe(
                state => {
                    touched.reset();
                    if (state === 'SUCCESS' || state === 'ERROR') {
                        this.onClose();
                    }
                }
            )
        );
    }

    regenerate() {
        if (this.errors().length > 0) {
            this.errors.showAllMessages();
        } else {
            regenerateAccountCredentials(ko.unwrap(this.email), this.password());
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

