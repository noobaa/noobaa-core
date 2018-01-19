/* Copyright (C) 2016 NooBaa */

import template from './bucket-s3-access-table.html';
import Observer from 'observer';
import ko from 'knockout';
import AccountRowViewModel from './account-row';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { state$, action$ } from 'state';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import { requestLocation, openBucketS3AccessModal } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'name',
        type: 'newLink',
        sortable: true,
        compareKey: account => account.name
    },
    {
        name: 'credentialsDetails',
        type: 'button'
    }
]);

class BucketS3AccessTableViewModel extends Observer {
    columns = columns;
    bucketName = '';
    pathname = '';
    accounts = ko.observable();
    accountsLoaded = ko.observable();
    sorting = ko.observable();
    accountCount = ko.observable();
    rows = ko.observableArray();

    constructor({ bucketName }) {
        super();

        this.bucketName = ko.unwrap(bucketName);
        this.observe(state$.getMany('accounts', 'location'), this.onState);
    }

    onState([accounts, location]) {
        if (!accounts) {
            this.accountsLoaded(false);
            this.accountCount(0);
            return;
        }

        const { sortBy = 'name', order = 1 } = location.query;
        const { compareKey } = columns.find(column => column.name === sortBy);
        const compareOp = createCompareFunc(compareKey, order);
        const accountList = Object.values(accounts);
        const filteredAccounts = accountList
            .filter(account => account.allowedBuckets.includes(this.bucketName));
        const rowParams = {
            baseRoute: realizeUri(routes.account, { system: location.params.system }, {}, true)
        };

        const rows = filteredAccounts
            .sort(compareOp)
            .map((account, i) => {
                const row = this.rows.get(i) || new AccountRowViewModel(rowParams);
                row.onState(account, location.hostname);
                return row;
            });

        this.rows(rows);
        this.sorting({ sortBy, order: Number(order) });
        this.accountCount(filteredAccounts.length);
        this.pathname = location.pathname;
        this.accountsLoaded(true);
    }

    onSort(sorting) {
        const query = ko.deepUnwrap(sorting);
        const url = realizeUri(this.pathname, {}, query);
        action$.onNext(requestLocation(url));
    }

    onEditS3Access() {
        action$.onNext(openBucketS3AccessModal(this.bucketName));
    }
}

export default {
    viewModel: BucketS3AccessTableViewModel,
    template: template
};
