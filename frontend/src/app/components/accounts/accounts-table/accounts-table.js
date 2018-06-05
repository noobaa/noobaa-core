/* Copyright (C) 2016 NooBaa */

import template from './accounts-table.html';
import Observer from 'observer';
import ko from 'knockout';
import AccountRowViewModel from './account-row';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import { inputThrottle, paginationPageSize } from 'config';
import { action$, state$ } from 'state';
import { realizeUri } from 'utils/browser-utils';
import { getMany } from 'rx-extensions';
import * as routes from 'routes';
import {
    requestLocation,
    openCreateAccountModal,
    tryDeleteAccount
} from 'action-creators';

const columns = deepFreeze([
    {
        name: 'name',
        label: 'account name',
        type: 'newLink',
        sortable: true,
        compareKey: account => account.name
    },
    {
        name: 'loginAccess',
        label: 'Login Access',
        sortable: true,
        compareKey: account => account.hasLoginAccess
    },
    {
        name: 's3Access',
        label: 's3 access',
        sortable: true,
        compareKey: account => account.hasS3Access
    },
    {
        name: 'role',
        sortable: true,
        compareKey: account => _getAccountRole(account)
    },
    {
        name: 'defaultResource',
        sortable: true,
        compareKey: account => account.defaultResource
    },
    {
        name: 'deleteButton',
        label: '',
        type: 'delete'
    }
]);

function _getAccountRole(account) {
    return !account.isOwner ?
        (account.hasLoginAccess ? 'admin' : 'application') :
        'owner';
}

class AccountsTableViewModel extends Observer {
    constructor() {
        super();

        this.columns = columns;
        this.pathname = '';
        this.accountsLoading = ko.observable();
        this.rows = ko.observableArray();
        this.filter = ko.observable();
        this.sorting = ko.observable();
        this.pageSize = paginationPageSize;
        this.page = ko.observable();
        this.accountCount = ko.observable();
        this.onFilterThrottled = throttle(this.onFilter, inputThrottle, this);

        this.observe(
            state$.pipe(
                getMany(
                    'accounts',
                    'location',
                    'session'
                )
            ),
            this.onAccounts
        );
    }

    onAccounts([accounts, location, session]) {
        if (!accounts) {
            this.accountsLoading(true);
            return;
        }
        const { params, query, pathname } = location;
        const { system, tab = 'accounts' } = params;
        if ((tab !== 'accounts') || !session) return;

        const { filter = '', sortBy = 'name', order = 1, page = 0, selectedForDelete } = query;
        const { compareKey } = columns.find(column => column.name === sortBy);
        const accountList = Object.values(accounts);
        const pageStart = Number(page) * this.pageSize;
        const rowParams = {
            baseRoute: realizeUri(routes.account, { system }, {}, true),
            onSelectForDelete: this.onSelectForDelete.bind(this),
            onDelete: this.onDeleteAccount.bind(this)
        };

        const filteredRows = accountList
            .filter(account => !filter || account.name.toLowerCase().includes(filter.toLowerCase()));

        const rows = filteredRows
            .sort(createCompareFunc(compareKey, order))
            .slice(pageStart, pageStart + this.pageSize)
            .map((account, i) => {
                const row = this.rows.get(i) || new AccountRowViewModel(rowParams);
                row.onAccount(account, _getAccountRole(account), session.user, selectedForDelete);
                return row;
            });

        this.pathname = pathname;
        this.filter(filter);
        this.sorting({ sortBy, order: Number(order) });
        this.page(Number(page));
        this.accountCount(filteredRows.length);
        this.rows(rows);
        this.accountsLoading(false);
    }

    onFilter(filter) {
        const { sortBy, order } = this.sorting();
        const query = {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: 0,
            selectedForDelete: undefined
        };

        action$.next(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onSort({ sortBy, order }) {
        const query = {
            filter: this.filter() || undefined,
            sortBy: sortBy,
            order: order,
            page: 0,
            selectedForDelete: undefined
        };

        action$.next(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onPage(page) {
        const { sortBy, order } = this.sorting();
        const query = {
            filter: this.filter() || undefined,
            sortBy: sortBy,
            order: order,
            page: page,
            selectedForDelete: undefined
        };

        action$.next(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onSelectForDelete(account) {
        const { sortBy, order } = this.sorting();
        const query = {
            filter: this.filter() || undefined,
            sortBy: sortBy,
            order: order,
            page: this.page(),
            selectedForDelete: account || undefined
        };

        action$.next(requestLocation(
            realizeUri(this.pathname, {}, query)
        ));
    }

    onCreateAccount() {
        action$.next(openCreateAccountModal());
    }

    onDeleteAccount(email, isCurrentUser) {
        action$.next(tryDeleteAccount(email, isCurrentUser));
    }
}

export default {
    viewModel: AccountsTableViewModel,
    template: template
};
