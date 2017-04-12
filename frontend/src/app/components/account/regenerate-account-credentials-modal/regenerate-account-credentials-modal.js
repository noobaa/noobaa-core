import template from './regenerate-account-credentials-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { regenerateAccountCredentials } from 'actions';
import { regenerateCredentialState } from 'model';

class RegenerateAccountCredentialsModalViewModel extends BaseViewModel {
    constructor({ onClose, email }) {
        super();

        this.onClose = onClose;
        this.email = email;
        this.password = ko.observable()
            .extend({
                required: { message: 'Password is required for security purposes' },
                validation: {
                    validator: () => this.touched() || regenerateCredentialState() !== 'UNAUTHORIZED',
                    message: 'Please make sure your password is correct'
                }
            });
        this.touched = ko.touched(this.password);

        this.errors = ko.validation.group(this);

        this.addToDisposeList(
            regenerateCredentialState.subscribe(
                state => {
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
            this.touched(false);
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

