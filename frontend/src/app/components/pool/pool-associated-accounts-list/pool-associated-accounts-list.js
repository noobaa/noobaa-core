/* Copyright (C) 2016 NooBaa */

import template from './pool-associated-accounts-list.html';
import Observer from 'observer';
import { state$ } from 'state';
import * as routes from 'routes';
import ko from 'knockout';
import { realizeUri } from 'utils/browser-utils';

class PoolAssociatedAccountsListViewModel extends Observer {
    constructor({ poolName }) {
        super();

        this.accountsLoaded = ko.observable(false);
        this.accounts = ko.observableArray();
        this.accountCount = ko.observable('');

        this.observe(
            state$.getMany(
                ['hostPools', ko.unwrap(poolName), 'associatedAccounts'],
                ['location', 'params', 'system']
            ),
            this.onAccounts
        );
    }

    onAccounts([ accounts, system ]) {
        if (!accounts) return;

        this.accounts(
            accounts.map(account => ({
                email: account,
                href: realizeUri(routes.account, { system, account })
            }))
        );
        this.accountCount(accounts.length.toString());
        this.accountsLoaded(true);
    }
}

export default {
    viewModel: PoolAssociatedAccountsListViewModel,
    template: template
};
