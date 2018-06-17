/* Copyright (C) 2016 NooBaa */

import template from './pool-connected-buckets-table.html';
import ConnectableViewModel from 'components/connectable';
import ko from 'knockout';
import { deepFreeze, memoize, createCompareFunc, decimalRound } from 'utils/core-utils';
import { realizeUri } from 'utils/browser-utils';
import { formatSize } from 'utils/size-utils';
import { getUsageDistribution } from 'utils/resource-utils';
import { paginationPageSize } from 'config';
import { requestLocation } from 'action-creators';
import numeral from 'numeral';
import * as routes from 'routes';

const waitingToBeWipedWarning = 'The bucket is no longer using this resource as storage and it is currently wiping it’s stored data. Once done, it will not be shown as a connected bucket.';

const columns = deepFreeze([
    {
        name: 'name',
        label: 'Bucket Name',
        type: 'newLink',
        sortable: true,
        compareKey: item => item.name
    },
    {
        name: 'usage',
        label: 'Usage Type',
        sortable: true,
        type: 'usage',
        compareKey: item => item.reason
    },
    {
        name: 'distribution',
        label: 'Usage Distribution',
        sortable: true,
        compareKey: item => item.ratio
    }
]);

function _formatRatio(ratio) {
    const rounded = decimalRound(ratio, 3);
    return numeral(rounded).format(Number.isInteger(rounded * 100) ? '%' : '0.0%');
}

class BucketRowViewModel {
    name = ko.observable();
    usage = ko.observable();
    distribution = ko.observable();
}

class PoolConnectedBucketsTableViewModel extends ConnectableViewModel {
    columns = columns;
    pageSize = paginationPageSize;
    pathname = '';
    dataLoaded = ko.observable();
    bucketCount = ko.observable();
    page = ko.observable();
    sorting = ko.observable();
    rows = ko.observableArray()
        .ofType(BucketRowViewModel)

    selectUsageDistribution = memoize((pool, buckets) => {
        return pool ? getUsageDistribution('HOSTS', pool.name, buckets) : [];
    });

    selectState(state, params) {
        const { hostPools = {}, buckets = {}, location } = state;
        const pool = hostPools[params.poolName];
        const usageDistribution = this.selectUsageDistribution(pool, buckets);

        return [
            pool,
            usageDistribution,
            location
        ];
    }

    mapStateToProps(pool, usageDistribution, location) {
        const { params, query, pathname } = location;

        const { system, tab } = params;
        if (tab && tab !== 'connected-buckets' || !pool) {
            ko.assignToProps(this, { dataLoaded: false });

        } else {
            const sortBy = query.sortBy || 'name';
            const order = Number(query.order || 1);
            const page = Number(query.page || 0);
            const pageStart = page * paginationPageSize;
            const { compareKey } = columns.find(column => column.name === sortBy);
            const usageList = Array.from(usageDistribution)
                .sort(createCompareFunc(compareKey, order))
                .slice(pageStart, pageStart + paginationPageSize);

            ko.assignToProps(this, {
                dataLoaded: true,
                pathname: pathname,
                page: page,
                sorting: { sortBy, order },
                bucketCount: usageDistribution.length,
                rows: usageList.map(record => {
                    const { bucket, size, ratio, reason } = record;
                    const href = realizeUri(routes.bucket, { system, bucket});
                    const usageWarning = reason === 'WAITING_TO_BE_WIPED' ?
                        waitingToBeWipedWarning :
                        '';

                    return {
                        name : { text: bucket, href },
                        usage: { size: formatSize(size), usageWarning },
                        distribution: _formatRatio(ratio)
                    };
                })
            });
        }
    }

    onPage(page) {
        this._query({ page });
    }

    onSort(sorting) {
        this._query(sorting);
    }

    _query(params) {
        const {
            page = this.page(),
            sortBy = this.sorting().sortBy,
            order = this.sorting().order
        } = params;

        const url = realizeUri(this.pathname, null, { page, sortBy, order });
        this.dispatch(requestLocation(url));
    }

}

export default {
    viewModel: PoolConnectedBucketsTableViewModel,
    template: template
};
