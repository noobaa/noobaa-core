import template from './pool-associated-accounts-list.html';
import Observer from 'observer';
import state$ from 'state';
import * as routes from 'routes';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

// TODO: Replace with data from the state$ when available.
import { routeContext } from 'model';

class PoolAssociatedAccountsListViewModel extends Observer {
    constructor({ poolName }) {
        super();

        this.accounts = ko.observable();
        this.accountCount = ko.observable();

        this.observe(
            state$.get('nodePools', ko.unwrap(poolName), 'associatedAccounts'),
            this.onAccounts
        );
    }

    onAccounts(accounts) {
        const system = routeContext().params.system;

        this.accounts(
            accounts.map(account => ({
                email: account,
                href: realizeUri(routes.account, { system, account })
            }))
        );
        this.accountCount(accounts.length);
    }
}

export default {
    viewModel: PoolAssociatedAccountsListViewModel,
    template: template
};
