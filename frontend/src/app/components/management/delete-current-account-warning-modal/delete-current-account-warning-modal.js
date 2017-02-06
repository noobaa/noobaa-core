import template from './delete-current-account-warning-modal.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { sessionInfo } from 'model';
import { deleteAccount } from 'actions';

class DeleteAccountWarningModalViewModel extends BaseViewModel {
    constructor({ onClose }) {
        super();

        this.onClose = onClose;
        this.email = ko.pureComputed(
            () => sessionInfo().user
        );
    }

    del() {
        deleteAccount(this.email());
    }

    cancel() {
        this.onClose();
    }
}

export default {
    viewModel: DeleteAccountWarningModalViewModel,
    template: template
};
