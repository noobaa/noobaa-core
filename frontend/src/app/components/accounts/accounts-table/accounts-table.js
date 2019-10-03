/* Copyright (C) 2016 NooBaa */

import template from './accounts-table.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, throttle, createCompareFunc } from 'utils/core-utils';
import { inputThrottle, paginationPageSize } from 'config';
import { realizeUri } from 'utils/browser-utils';
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
        type: 'link',
        sortable: true,
        compareKey: account => account.name
    },
    {
        name: 'accessType',
        sortable: true,
        compareKey: account => account.isAdmin
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

function _mapAccountToRow(account, currentUser, baseRoute, selectedForDelete) {
    const { name, isOwner, defaultResource } = account;
    const isCurrentUser = name === currentUser;
    const accountNameText = `${name} ${isCurrentUser ? '(Current user)' : ''}`;
    const usingInternalStorage = defaultResource === 'INTERNAL_STORAGE';

    return {
        isCurrentUser,
        name: {
            text: accountNameText,
            href: realizeUri(baseRoute, { account: name }),
            tooltip: accountNameText
        },
        accessType: account.isAdmin ? 'Administator' : 'Application',
        defaultResource: {
            text: false ||
                (usingInternalStorage && 'Using internal storage') ||
                (!defaultResource && '(not set)') ||
                defaultResource,
            tooltip: defaultResource &&
                !usingInternalStorage &&
                { text: defaultResource, breakWords: true }
        },
        deleteButton: {
            id: name,
            active: selectedForDelete === name,
            disabled: isOwner,
            tooltip: isOwner ?
                'Cannot delete system owner' :
                'Delete account'
        }
    };
}

class AccountRowViewModel {
    table = null;
    name = ko.observable();
    accessType = ko.observable();
    defaultResource = ko.observable();
    isCurrentUser = false;
    deleteButton = {
        id: ko.observable(),
        text: 'Delete Account',
        active: ko.observable(),
        disabled: ko.observable(),
        tooltip: ko.observable(),
        onToggle: this.onSelectForDelete.bind(this),
        onDelete: this.onDelete.bind(this)
    };

    constructor({ table }) {
        this.table = table;
    }

    onSelectForDelete(email) {
        this.table.onSelectForDelete(email);
    }

    onDelete(email) {
        this.table.onDeleteAccount(email, this.isCurrentUser);
    }
}

class AccountsTableViewModel extends ConnectableViewModel {
    columns = columns;
    pathname = '';
    dataReady = ko.observable();
    filter = ko.observable();
    sorting = ko.observable();
    page = ko.observable();
    pageSize = ko.observable();
    selectedForDelete = ko.observable();
    accountCount = ko.observable();
    onFilterThrottled = throttle(this.onFilter, inputThrottle, this);
    rows = ko.observableArray()
        .ofType(AccountRowViewModel, { table: this })

    selectState(state) {
        return [
            state.accounts,
            state.location,
            state.session
        ];
    }

    mapStateToProps(accounts, location, session) {
        if (!accounts || !session) {
            ko.assignToProps(this, {
                dataReady: false
            });

        } else {
            const { system, tab = 'accounts' } = location.params;
            if (tab !== 'accounts') {
                return;
            }

            const { filter = '', sortBy = 'name', selectedForDelete = '' } = location.query;
            const page = Number(location.query.page) || 0;
            const pageSize = Number(location.query.pageSize) || paginationPageSize.default;
            const order = Number(location.query.order) || 1;
            const { compareKey } = columns.find(column => column.name === sortBy);
            const compareAccounts = createCompareFunc(compareKey, order);
            const accountList = Object.values(accounts)
                .filter(account => !account.roles.includes('operator'));
            const pageStart = page * pageSize;
            const filteredRows = accountList.filter(account =>
                !filter || account.name.toLowerCase().includes(filter.toLowerCase())
            );

            ko.assignToProps(this, {
                dataReady: true,
                pathname: location.pathname,
                filter,
                sorting: { sortBy, order },
                page,
                pageSize,
                selectedForDelete,
                accountCount: filteredRows.length,
                rows: filteredRows
                    .sort(compareAccounts)
                    .slice(pageStart, pageStart + pageSize)
                    .map(account => _mapAccountToRow(
                        account,
                        session.user,
                        realizeUri(routes.account, { system }, {}, true),
                        selectedForDelete
                    ))
            });
        }
    }

    onFilter(filter) {
        this.onQuery({
            filter,
            page: 0,
            selectedForDelete: undefined
        });
    }

    onSort({ sortBy, order }) {
        this.onQuery({
            sortBy,
            order,
            page: 0,
            selectedForDelete: undefined
        });
    }

    onPage(page) {
        this.onQuery({
            page,
            selectedForDelete: undefined
        });
    }

    onPageSize(pageSize) {
        this.onQuery({
            pageSize,
            page: 0,
            selectedForDelete: undefined
        });
    }

    onSelectForDelete(account) {
        this.onQuery({ selectedForDelete: account });
    }

    onQuery(query) {
        const {
            filter = this.filter(),
            sortBy = this.sorting().sortBy,
            order = this.sorting.order,
            page = this.page(),
            pageSize = this.pageSize(),
            selectedForDelete = this.selectedForDelete()
        } = query;

        const uri = realizeUri(this.pathname, {}, {
            filter: filter || undefined,
            sortBy,
            order,
            page,
            pageSize,
            selectedForDelete: selectedForDelete || undefined
        });

        this.dispatch(requestLocation(uri));
    }

    onCreateAccount() {
        this.dispatch(openCreateAccountModal());
    }

    onDeleteAccount(email, isCurrentUser) {
        this.dispatch(tryDeleteAccount(email, isCurrentUser));
    }
}

export default {
    viewModel: AccountsTableViewModel,
    template: template
};
