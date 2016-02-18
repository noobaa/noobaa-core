import template from './accounts-table.html';
import ko from 'knockout';
import AccountRowViewModel from './account-row';
import { accountList } from 'model';
import { loadAccountList } from 'actions';
import { makeArray } from 'utils';

const maxRows = 100;

class AccountsTableViewModel {
    constructor() {
        this.deleteGroup = ko.observable();
        this.selectedAccount = ko.observable();

        this.rows = makeArray(
            maxRows, 
            i => new AccountRowViewModel(
                () => accountList()[i], this.deleteGroup
            )
        );

        this.isCreateAccountModalVisible = ko.observable(false);
        this.isResetPasswordModalVisible = ko.observable(false);
        loadAccountList();
    }

    showResetPasswordModal(email) {
        this.selectedAccount(ko.unwrap(email));
        this.isResetPasswordModalVisible(true);
    }
}

export default {
    viewModel: AccountsTableViewModel,
    template: template
}