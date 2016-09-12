import template from './accounts-table.html';
import Disposable from 'disposable';
import ko from 'knockout';
import AccountRowViewModel from './account-row';
import { systemInfo } from 'model';
import { deepFreeze } from 'utils';

const columns = deepFreeze([
    {
        name: 'name',
        label: 'account name'
    },
    {
        name: 'role'
    },
    {
        name: 's3Access',
        label: 's3 access',
        cellTemplate: 's3-access'
    },
    {
        name: 'password',
        cellTemplate: 'password'
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        cellTemplate: 'delete'
    }
]);

class AccountsTableViewModel extends Disposable {
    constructor() {
        super();

        this.columns = columns;
        this.deleteGroup = ko.observable();
        this.selectedAccount = ko.observable();
        this.accounts = ko.pureComputed(
            () => systemInfo() && systemInfo().accounts.filter(
                account => !account.is_support
            )
        );

        this.isCreateAccountModalVisible = ko.observable(false);
        this.resetPasswordTarget = ko.observable(null);
        this.editS3AccessTarget = ko.observable(null);
    }

    createAccountRow(account) {
        return new AccountRowViewModel(account, this);
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
