/* Copyright (C) 2016 NooBaa */

import template from './gateway-bucket-s3-access-form.html';
import Observer from 'observer';
import AccountRowViewModel from './account-row';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { state$, action$ } from 'state';
import { openBucketS3AccessModal } from 'action-creators';

const columns = deepFreeze([
    {
        name: 'name',
        type: 'text',
    },
    {
        name: 'credentialsDetails',
        type: 'button'
    }
]);


class GatewayBucketS3AccessFormViewModel extends Observer {
    constructor({ bucket }) {
        super();

        this.columns = columns;
        this.bucketName = ko.unwrap(bucket);
        this.accountsLoaded = ko.observable();
        this.accountCount = ko.observable();
        this.rows = ko.observableArray();

        this.observe(state$.get('accounts'), this.onAccounts);
    }

    onAccounts(accounts) {
        if (!accounts) {
            this.accountsLoaded(false);
            return;
        }

        const filteredAccounts = Object.values(accounts)
            .filter(account => account.allowedBuckets.includes(this.bucketName));

        const rows = filteredAccounts
            .map((account, i) => {
                const row = this.rows()[i] || new AccountRowViewModel();
                row.onAccount(account);
                return row;
            });

        this.accountCount(filteredAccounts.length);
        this.rows(rows);
        this.accountsLoaded(true);
    }

    onEditS3Access() {
        action$.onNext(openBucketS3AccessModal(this.bucketName));
    }
}

export default {
    viewModel: GatewayBucketS3AccessFormViewModel,
    template: template
};
