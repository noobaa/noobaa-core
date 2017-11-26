/* Copyright (C) 2016 NooBaa */

import template from './namespace-bucket-s3-access-form.html';
import Observer from 'observer';
import AccountRowViewModel from './account-row';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { state$, action$ } from 'state';
import { openBucketS3AccessModal } from 'action-creators';
import numeral from 'numeral';
import * as routes from 'routes';

const columns = deepFreeze([
    {
        name: 'name',
        type: 'newLink'
    },
    {
        name: 'credentialsDetails',
        type: 'button'
    }
]);


class NamespaceBucketS3AccessFormViewModel extends Observer {
    constructor({ bucket }) {
        super();

        this.columns = columns;
        this.bucketName = ko.unwrap(bucket);
        this.accountsLoaded = ko.observable();
        this.accountCount = ko.observable();
        this.rows = ko.observableArray();

        this.observe(
            state$.getMany('accounts', 'location'),
            this.onAccounts
        );
    }

    onAccounts([accounts, location]) {
        if (!accounts) {
            this.accountsLoaded(false);
            return;
        }

        const filteredAccounts = Object.values(accounts)
            .filter(account => account.allowedBuckets.includes(this.bucketName));

        const { system } = location.params;
        const accountRoute = realizeUri(routes.account, { system }, {}, true);

        const rows = filteredAccounts
            .map((account, i) => {
                const row = this.rows()[i] || new AccountRowViewModel();
                row.onAccount(account, accountRoute);
                return row;
            });

        const accountCount = numeral(filteredAccounts.length)
            .format('0,0');

        this.accountCount(accountCount);
        this.rows(rows);
        this.accountsLoaded(true);
    }

    onEditS3Access() {
        action$.onNext(openBucketS3AccessModal(this.bucketName));
    }
}

export default {
    viewModel: NamespaceBucketS3AccessFormViewModel,
    template: template
};
