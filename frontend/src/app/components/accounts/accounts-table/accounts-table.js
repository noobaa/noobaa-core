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

function _mapAccountToRow(account, currentUser, baseRoute, selectedForDelete) {
    const { name, isOwner, hasS3Access, hasLoginAccess, defaultResource } = account;
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
        role: _getAccountRole(account),
        s3Access: hasS3Access ? 'enabled' : 'disabled',
        loginAccess: hasLoginAccess ? 'enabled' : 'disabled',
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
    name = ko.observable();
    role = ko.observable();
    s3Access = ko.observable();
    loginAccess = ko.observable();
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
    pageSize = paginationPageSize;
    page = ko.observable();
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
            const page = Number(location.query.page || 0);
            const order = Number(location.query.order || 0);
            const { compareKey } = columns.find(column => column.name === sortBy);
            const compareAccounts = createCompareFunc(compareKey, order);
            const accountList = Object.values(accounts);
            const pageStart = page * this.pageSize;
            const filteredRows = accountList.filter(account =>
                !filter || account.name.toLowerCase().includes(filter.toLowerCase())
            );

            ko.assignToProps(this, {
                dataReady: true,
                pathname: location.pathname,
                filter,
                sorting: { sortBy, order },
                page,
                selectedForDelete,
                accountCount: filteredRows.length,
                rows: filteredRows
                    .sort(compareAccounts)
                    .slice(pageStart, pageStart + this.pageSize)
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

    onSelectForDelete(account) {
        this.onQuery({ selectedForDelete: account });
    }

    onQuery(query) {
        const {
            filter = this.filter(),
            sortBy = this.sorting().sortBy,
            order = this.sorting.order,
            page = this.page(),
            selectedForDelete = this.selectedForDelete()
        } = query;

        const uri = realizeUri(this.pathname, {}, {
            filter: filter || undefined,
            sortBy: sortBy,
            order: order,
            page: page,
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
