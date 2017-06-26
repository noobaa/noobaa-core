/* Copyright (C) 2016 NooBaa */

import template from './accounts-table.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import AccountRowViewModel from './account-row';
import { systemInfo, routeContext } from 'model';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import { inputThrottle } from 'config';
import { navigateTo } from 'actions';
import { dispatch } from 'state';
import { openCreateAccountModal } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'name',
        label: 'account name',
        type: 'link',
        sortable: true
    },
    {
        name: 'loginAccess',
        label: 'Login Access',
        sortable: 'login-access'
    },
    {
        name: 's3Access',
        label: 's3 access',
        sortable: 's3-access'
    },
    {
        name: 'role',
        sortable: true
    },
    {
        name: 'defaultResource',
        sortable: true
    },
    {
        name: 'deleteButton',
        label: '',
        css: 'delete-col',
        type: 'delete'
    }
]);

function getAccountRole(account) {
    return account.email !== systemInfo().owner.email ?
        (account.had_login ? 'admin' : 'application') :
        'owner';
}

const compareAccessors = deepFreeze({
    name: account => account.email,
    connections: account => account.external_connections.count,
    role: account => getAccountRole(account),
    's3-access': account => account.has_s3_access,
    'login-access': account => account.has_login,
    defaultResource: account => account.default_pool
});

class AccountsTableViewModel extends BaseViewModel {
    constructor() {
        super();

        this.columns = columns;
        this.deleteGroup = ko.observable();

        const query = ko.pureComputed(
            () => routeContext().query || {}
        );

        this.filter = ko.pureComputed({
            read: () => query().filter,
            write: throttle(phrase => this.filterAccounts(phrase), inputThrottle)
        });

        this.sorting = ko.pureComputed({
            read: () => ({
                sortBy: query().sortBy || 'name',
                order: Number(query().order) || 1
            }),
            write: value => this.orderBy(value)
        });

        this.accounts = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return [];
                }

                const { sortBy, order } = this.sorting();
                const compareOp = createCompareFunc(compareAccessors[sortBy], order);

                return (systemInfo().accounts || [])
                    .filter(
                        account => !account.is_support &&
                            account.email.includes(this.filter() || '')
                    )
                    .sort(compareOp);
            }
        );

        this.isCreateAccountModalVisible = ko.observable(false);
    }

    filterAccounts(phrase) {
        const params = Object.assign(
            { filter: phrase || undefined },
            this.sorting()
        );

        navigateTo(undefined, undefined, params);
    }

    orderBy({ sortBy, order }) {
        const filter = this.filter() || undefined;
        navigateTo(undefined, undefined, { filter, sortBy, order });
    }

    createAccountRow(account) {
        return new AccountRowViewModel(account, this.deleteGroup);
    }

    onCreateAccount() {
        dispatch(openCreateAccountModal());
    }
}

export default {
    viewModel: AccountsTableViewModel,
    template: template
};
