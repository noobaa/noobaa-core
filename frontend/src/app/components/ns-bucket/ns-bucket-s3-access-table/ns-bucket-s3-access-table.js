/* Copyright (C) 2016 NooBaa */

import template from './ns-bucket-s3-access-table.html';
import Observer from 'observer';
import AccountRowViewModel from './account-row';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { state$ } from 'state';

const columns = deepFreeze([
    {
        name: 'accountName',
        type: 'link',
    },
    {
        name: 'credentialsDetails',
        type: 'button'
    }
]);


class NSBucketS3AccessTableViewModel extends Observer {
    constructor({ bucket }) {
        super();

        this.columns = columns;
        this.bucketName = ko.unwrap(bucket);
        this.rows = ko.observableArray();

        this.observe(state$.get('accounts'), this.onAccounts);
    }

    onAccounts(accounts) {
        const permittedAccounts = Object.values(accounts);
            // .filter(account => account.allowedBuckets.includes(this.bucketName));

        this.rows(permittedAccounts.map((account, i) => {
            const row = this.rows()[i] || new AccountRowViewModel();
            row.onAccount(account);
            return row;
        }));

    }
}

export default {
    viewModel: NSBucketS3AccessTableViewModel,
    template: template
};
