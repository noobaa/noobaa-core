/* Copyright (C) 2016 NooBaa */

import template from './bucket-s3-access-list.html';
import BaseViewModel from 'components/base-view-model';
import ko from 'knockout';
import { systemInfo, routeContext } from 'model';
import S3AccessRowViewModel from './s3-access-row';
import { deepFreeze, createCompareFunc } from 'utils/core-utils';
import { navigateTo } from 'actions';
import { openBucketS3AccessModal } from 'dispatchers';

const columns = deepFreeze([
    {
        name: 'name',
        type: 'link',
        sortable: true
    },
    {
        name: 'recentlyUsed',
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
                    .filter(
                        account => (account.allowed_buckets || [])
                            .includes(ko.unwrap(bucketName))
                    )
                    .sort(compareOp);
            }
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
        openBucketS3AccessModal(
            ko.unwrap(this.bucketName)
        );
    }

    createS3AccessRow(accessRow) {
        return new S3AccessRowViewModel(accessRow);
    }
}

export default {
    viewModel: BucketS3AccessListViewModel,
    template: template
};
