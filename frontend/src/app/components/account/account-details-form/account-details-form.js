import template from './account-details-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { routeContext, systemInfo, sessionInfo } from 'model';

class AccountDetailsFormViewModel extends Disposable{
    constructor() {
        super();

        const account = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return;
                }

                const email = routeContext().params.account;
                return systemInfo().accounts.find(
                    account => account.email === email
                );
            }
        );

        this.email = ko.pureComputed(
            () => account() && account().email
        );

        const systemName = ko.pureComputed(
            () => systemInfo() ? systemInfo().name : ''
        );

        const isSystemOwner = ko.pureComputed(
            () => systemInfo() && this.email() === systemInfo().owner.email
        );

        const role = ko.pureComputed(
            () => {
                if (!account() || !systemName()) {
                    return '';
                }

                return isSystemOwner() ? 'owner' : account().systems.find(
                    ({ name }) => name === systemName()
                ).roles[0];
            }
        );

        this.isCurrentUser = ko.pureComputed(
            () => sessionInfo() && sessionInfo().user === this.email()
        );

        this.changePasswordButtonText = ko.pureComputed(
            () => this.isCurrentUser() ? 'Change Password' : 'Reset Password'
        );

        this.profileInfo = [
            { label: 'Email address', value: this.email },
            { label: 'Role', value: role }
        ];

        this.isResetPasswordModalVisible = ko.observable(false);
        this.isChangePasswordModalVisible = ko.observable(false);
    }

    changePasswordClickHandler() {
        if (this.isCurrentUser()) {
            this.isChangePasswordModalVisible(true);
        } else {
            this.isResetPasswordModalVisible(true);
        }
    }

    hideResetPasswordModal() {
        this.isResetPasswordModalVisible(false);
    }

    hideChangePasswordModal() {
        this.isChangePasswordModalVisible(false);
    }
}

export default {
    viewModel: AccountDetailsFormViewModel,
    template: template
};
