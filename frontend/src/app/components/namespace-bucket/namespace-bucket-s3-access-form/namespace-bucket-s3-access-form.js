/* Copyright (C) 2016 NooBaa */

import template from './namespace-bucket-s3-access-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import * as routes from 'routes';
import {
    requestLocation,
    openBucketS3AccessModal,
    openS3AccessDetailsModal
} from 'action-creators';

const columns = deepFreeze([
    {
        name: 'name',
        type: 'link',
        sortable: true,
        compareKey: account => account.name
    },
    {
        name: 'credentialsDetails',
        type: 'button'
    }
]);

class AccountRowViewModel {
    name = {
        text: ko.observable(),
        href: ko.observable()
    };
    credentialsDetails = {
        text: 'View',
        click: this.onShowDetails.bind(this)
    };
    accessDetails = null;

    constructor({ table }) {
        this.table = table;
    }

    onShowDetails() {
        this.table.onShowAccessDetails(this.accessDetails);
    }
}

class NamespaceBucketS3AccessFormViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    columns = columns;
    bucketName = '';
    pathname = '';
    accounts = ko.observable();
    sorting = ko.observable();
    accountCount = ko.observable();
    rows = ko.observableArray()
        .ofType(AccountRowViewModel, { table: this });

    selectState(state, params) {
        return [
            params.bucket,
            state.accounts,
            state.location
        ];
    }

    mapStateToProps(bucketName, accounts, location) {
        if (!accounts) {
            ko.assignToProps(this, {
                dataReady: false,
                bucketName,
                accountCount: 0
            });

        } else {
            const { sortBy = 'name', order = 1 } = location.query;
            const { compareKey } = columns.find(column => column.name === sortBy) || columns[0];
            const baseRoute = realizeUri(routes.account, { system: location.params.system }, {}, true);
            const filteredAccounts = Object.values(accounts)
                .filter(account => account.allowedBuckets.includes(this.bucketName));

            ko.assignToProps(this, {
                dataReady: true,
                bucketName,
                accountCount: filteredAccounts.length,
                sorting: { sortBy, order: Number(order) },
                pathname: location.pathname,
                rows: filteredAccounts
                    .sort(createCompareFunc(compareKey, order))
                    .map(account => ({
                        name: {
                            text: account.name,
                            href: realizeUri(baseRoute, { account: account.name })
                        },
                        accessDetails: {
                            endpoint: location.hostname,
                            ...account.accessKeys
                        }
                    }))
            });
        }
    }

    onSort(sorting) {
        const query = ko.deepUnwrap(sorting);
        const url = realizeUri(this.pathname, {}, query);
        this.dispatch(requestLocation(url));
    }

    onEditS3Access() {
        this.dispatch(openBucketS3AccessModal(this.bucketName));
    }

    onShowAccessDetails(accessDetails) {
        const { endpoint, accessKey, secretKey } = accessDetails;
        this.dispatch(openS3AccessDetailsModal(
            endpoint,
            accessKey,
            secretKey
        ));
    }
}

export default {
    viewModel: NamespaceBucketS3AccessFormViewModel,
    template: template
};
