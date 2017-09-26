/* Copyright (C) 2016 NooBaa */

import template from './bucket-s3-access-table.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo, routeContext } from 'model';
import AccountRowViewModel from './account-row';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { navigateTo } from 'actions';
import { action$ } from 'state';
import { openBucketS3AccessModal } from 'action-creators';
import numeral from 'numeral';

const columns = deepFreeze([
    {
        name: 'name',
        type: 'link',
        sortable: true
    },
    {
        name: 'credentialsDetails',
        type: 'button'
    }
]);

const compareAccessors = deepFreeze({
    name: account => account.email
});


class BucketS3AccessListViewModel extends BaseViewModel {
    constructor({ bucketName }) {
        super();

        this.columns = columns;
        this.accounts = ko.pureComputed(
            () => {
                if (!systemInfo()) {
                    return [];
                }

                const { sortBy, order } = this.sorting();
                const compareOp = createCompareFunc(compareAccessors[sortBy], order);

                return (systemInfo().accounts || [])
                    .filter(({ allowed_buckets })=> {
                        if (!allowed_buckets) {
                            return false;
                        }

                        const { full_permission, permission_list } = allowed_buckets;
                        return full_permission || permission_list.includes(ko.unwrap(bucketName));
                    })
                    .sort(compareOp);
            }
        );

        this.accountCount = ko.pureComputed(
            () => this.accounts ?
                numeral(this.accounts().length).format('0,0') :
                ''
        );

        const query = ko.pureComputed(
            () => routeContext().query || {}
        );

        this.sorting = ko.pureComputed({
            read: () => {
                const { sortBy, order } = query();
                const canSort = Object.keys(compareAccessors).includes(sortBy);
                return {
                    sortBy: (canSort && sortBy) || 'name',
                    order: (canSort && Number(order)) || 1
                };
            },
            write: value => this.orderBy(value)
        });

        this.selectedAccount = ko.observable();

        this.bucketName = bucketName;
    }

    orderBy({ sortBy, order }) {
        navigateTo(undefined, undefined, { filter: undefined, sortBy, order });
    }

    onEditS3Access() {
        action$.onNext(openBucketS3AccessModal(
            ko.unwrap(this.bucketName)
        ));
    }

    createS3AccessRow(accountRow) {
        return new AccountRowViewModel(accountRow);
    }
}

export default {
    viewModel: BucketS3AccessListViewModel,
    template: template
};
