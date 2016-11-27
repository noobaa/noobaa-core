import template from './account-profile-form.html';
import Disposable from 'disposable';
import ko from 'knockout';
import { routeContext, systemInfo } from 'model';

class AccountProfileFormViewModel extends Disposable{
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

        account.debug();

        const email = ko.pureComputed(
            () => account() && account().email
        );

        const systemName = ko.pureComputed(
            () => systemInfo() ? systemInfo().name : ''
        );

        const isSystemOwner = ko.pureComputed(
            () => systemInfo() && email() === systemInfo().owner.email
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

        this.profileInfo = [
            { label: 'Email address', value: email },
            { label: 'Role', value: role }
        ];
    }
}

export default {
    viewModel: AccountProfileFormViewModel,
    template: template
};
