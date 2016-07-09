import template from './accounts-table.html';
import BaseViewModel from 'base-view-model';
import ko from 'knockout';
import AccountRowViewModel from './account-row';
import { accountList } from 'model';
import { loadAccountList } from 'actions';
import { makeArray } from 'utils';

const maxRows = 100;

class AccountsTableViewModel extends BaseViewModel {
    constructor() {
        super();

        this.deleteGroup = ko.observable();
        this.selectedAccount = ko.observable();

        this.rows = makeArray(
            maxRows,
            i => new AccountRowViewModel(
                () => accountList()[i],
                this.deleteGroup
            )
        );

        this.isCreateAccountModalVisible = ko.observable(false);
        this.resetPasswordTarget = ko.observable(null);
        this.editS3AccessTarget = ko.observable(null);

        loadAccountList();
    }

    openCreateAccountModal() {
        this.isCreateAccountModalVisible(true);
    }

    closeCreateAccountModal() {
        this.isCreateAccountModalVisible(false);
    }

    openResetPasswordModal(email) {
        this.resetPasswordTarget(ko.unwrap(email));
    }

    closeResetPasswordModal() {
        this.resetPasswordTarget(null);
    }

    openS3AccessModal(email) {
        this.editS3AccessTarget(ko.unwrap(email));
    }

    closeS3AccessModal() {
        this.editS3AccessTarget(null);
    }
}

export default {
    viewModel: AccountsTableViewModel,
    template: template
};
