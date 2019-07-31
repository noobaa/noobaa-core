/* Copyright (C) 2016 NooBaa */

import template from './resource-associated-account-list.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import numeral from 'numeral';
import * as routes from 'routes';
import { realizeUri } from 'utils/browser-utils';
import { memoize, deepFreeze } from 'utils/core-utils';

const resourceTypeMeta = deepFreeze({
    HOSTS: {
        subject: 'pool',
        stateKey: 'hostPools'
    },
    CLOUD: {
        subject: 'cloud resource',
        stateKey: 'cloudResources'
    }
});

class AccountRowViewModel {
    name = ko.observable();
    href = ko.observable();
}

class ResourceAssociatedAccountListViewModel extends ConnectableViewModel {
    dataReady = ko.observable();
    subject = ko.observable();
    accountCount = ko.observable();
    accounts = ko.observableArray()
        .ofType(AccountRowViewModel);

    selectAccounts = memoize((names, accounts) => {
        return (
            accounts &&
            names &&
            names.map(name => accounts[name])
        );
    });

    selectState(state, params) {
        const { resourceType, resourceName } = params;
        const { subject, stateKey } = resourceTypeMeta[resourceType];
        const collection = state[stateKey];
        const accountsNames = collection &&
            collection[resourceName] &&
            collection[resourceName].associatedAccounts;

        return [
            this.selectAccounts(accountsNames, state.accounts),
            subject,
            state.location.params.system
        ];
    }

    mapStateToProps(accountList, subject, system) {
        if (!accountList) {
            ko.assignToProps(this, {
                subject: subject,
                accountCount: '',
                dataReady: false
            });

        } else {
            ko.assignToProps(this, {
                dataReady: true,
                subject: subject,
                accountCount: numeral(accountList.length || 0).format(','),
                accounts: accountList
                    .filter(account => account.roles.every(role => role !== 'operator'))
                    .map(account => ({
                        name: account.name,
                        href: realizeUri(
                            routes.account,
                            { system, account: account.name }
                        )
                    }))
            });
        }
    }
}

export default {
    viewModel: ResourceAssociatedAccountListViewModel,
    template: template
};
