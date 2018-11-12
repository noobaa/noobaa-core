/* Copyright (C) 2016 NooBaa */

import template from './bucket-s3-access-policy-form.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { stringifyAmount } from 'utils/string-utils';
import * as routes from 'routes';
import {
    requestLocation,
    openBucketS3AccessModal,
    openS3AccessDetailsModal
} from 'action-creators';

const policyName = 's3-access';

const columns = deepFreeze([
    {
        name: 'name',
        type: 'link'
    },
    {
        name: 'credentialsDetails',
        type: 'button'
    }
]);

function _mapAccountToRow(account, location) {
    const { hostname: endpoint, params } = location;
    const { name, accessKeys } = account;

    return {
        name: {
            text: name,
            tooltip: name,
            href: realizeUri(routes.account, {
                system: params.system,
                account: name
            })
        },
        connection: {
            ...accessKeys,
            endpoint
        }
    };
}

class AccountRowViewModel {
    table = null;
    connection = null;
    name = {
        text: ko.observable(),
        href: ko.observable()
    };
    credentialsDetails = {
        text: 'View',
        click: () => this.onShowDetails()
    };

    constructor({ table }) {
        this.table = table;
    }

    onShowDetails() {
        this.table.onShowAccountDetails(this.connection);
    }
}

class BucketS3AccessTableViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    stateIcon = {
        name: 'healthy',
        css: 'success'
    };
    isExpanded = ko.observable();
    toggleUri = '';
    summary = ko.observable();
    columns = columns;
    bucketName = '';
    rows = ko.observableArray()
        .ofType(AccountRowViewModel, { table: this })

    selectState(state) {
        return [
            state.accounts,
            state.location
        ];
    }

    mapStateToProps(accounts, location) {
        if (!accounts) {
            ko.assignToProps(this, {
                dataReady: false,
                accountCount: 0
            });

        } else {
            const { params } = location;
            const conenctedAccounts = Object.values(accounts).filter(account =>
                account.allowedBuckets.includes(params.bucket)
            );

            const accountCount = conenctedAccounts.length;
            const summary = `${
                stringifyAmount('account', accountCount, 'No')
            } ${
                accountCount === 1 ? 'is' : 'are'
            } granted access to this bucket`;

            const isExpanded = params.section === policyName;
            const toggleUri = realizeUri(routes.bucket, {
                system: params.system,
                bucket: params.bucket,
                tab: params.tab,
                section: isExpanded ? undefined : policyName
            });

            ko.assignToProps(this, {
                dataReady: true,
                bucketName: params.bucket,
                isExpanded,
                toggleUri,
                summary,
                rows: conenctedAccounts.map(account =>
                    _mapAccountToRow(account, location)
                )
            });
        }
    }

    onToggleSection() {
        this.dispatch(requestLocation(this.toggleUri));
    }

    onShowAccountDetails(connection) {
        const { endpoint, accessKey, secretKey } = connection;
        this.dispatch(openS3AccessDetailsModal(endpoint, accessKey, secretKey));
    }

    onEditS3Access(_, evt) {
        this.dispatch(openBucketS3AccessModal(this.bucketName));
        evt.stopPropagation();
    }
}

export default {
    viewModel: BucketS3AccessTableViewModel,
    template: template
};
